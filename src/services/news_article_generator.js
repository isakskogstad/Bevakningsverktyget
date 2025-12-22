/**
 * Impact Loop News Article Generator
 *
 * Komplett pipeline för att generera nyhetsartiklar:
 * 1. Hämta företagsdata från Allabolag (via Python)
 * 2. Hämta logotyp från Supabase
 * 3. Scrapa pressbilder från företagets hemsida
 * 4. Generera nyhetsartikel med Claude
 * 5. Skapa HTML med faktaruta och öppna i browser
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getLinkedInProfiles, createMockProfiles } = require('./linkedin_scraper');

// Supabase config
const SUPABASE_URL = 'https://wzkohritxdrstsmwopco.supabase.co';
const LOGO_BUCKET = 'company-logos';

// Output directory
const OUTPUT_DIR = path.join(__dirname, '../../output');

/**
 * Hämtar företagsdata från Allabolag via Python
 */
async function fetchAllabolagData(orgnr) {
    return new Promise((resolve, reject) => {
        const pythonScript = `
from allabolag import Company
import json
import sys

try:
    c = Company("${orgnr.replace(/-/g, '')}")
    print(json.dumps(c.data, ensure_ascii=False, default=str))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

        const venvPython = path.join(__dirname, '../../.venv/bin/python3');
        const python = fs.existsSync(venvPython) ? venvPython : 'python3';

        const proc = spawn(python, ['-c', pythonScript]);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('[ALLABOLAG] Error:', stderr);
                resolve(null);
            } else {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    console.error('[ALLABOLAG] JSON parse error:', e);
                    resolve(null);
                }
            }
        });
    });
}

/**
 * Returnerar Supabase logotyp-URL
 */
function getLogoUrl(orgnr) {
    const clean = orgnr.replace(/-/g, '').replace(/ /g, '');
    return `${SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${clean}.png`;
}

/**
 * Kontrollerar om logotyp finns i Supabase
 */
async function checkLogoExists(orgnr) {
    return new Promise((resolve) => {
        const url = getLogoUrl(orgnr);

        https.get(url, (res) => {
            resolve(res.statusCode === 200);
        }).on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Scrapar pressbilder från företagets hemsida med Playwright
 * Söker på /press, /media, /nyheter, /news, /about och startsidan
 */
async function scrapePressImages(websiteUrl) {
    let browser = null;

    try {
        const { chromium } = require('playwright');
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();

        // Lista över möjliga press/media-sidor att prova
        const pressUrls = [
            websiteUrl + '/press',
            websiteUrl + '/media',
            websiteUrl + '/nyheter',
            websiteUrl + '/news',
            websiteUrl + '/about',
            websiteUrl + '/om-oss',
            websiteUrl
        ];

        let images = [];

        for (const url of pressUrls) {
            try {
                console.log(`   → Testar: ${url}`);
                await page.goto(url, { timeout: 15000, waitUntil: 'networkidle' });

                // Hämta alla bilder som är tillräckligt stora (>400px bredd, >300px höjd)
                const pageImages = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('img'))
                        .filter(img => {
                            const width = img.naturalWidth || img.width;
                            const height = img.naturalHeight || img.height;
                            return width >= 400 && height >= 300;
                        })
                        .map(img => ({
                            src: img.src,
                            alt: img.alt || '',
                            title: img.title || '',
                            width: img.naturalWidth || img.width,
                            height: img.naturalHeight || img.height
                        }))
                        .filter(img => !img.src.includes('logo') && !img.src.includes('icon'))
                        .slice(0, 5); // Max 5 bilder per sida
                });

                if (pageImages.length > 0) {
                    console.log(`   ✓ Hittade ${pageImages.length} bild(er) på ${url}`);
                    images = pageImages;
                    break; // Sluta leta om vi hittar bilder
                }
            } catch (e) {
                // Sidan kunde inte nås, prova nästa
                continue;
            }
        }

        await browser.close();
        return images;

    } catch (e) {
        console.error('[PLAYWRIGHT] Error:', e.message);
        if (browser) await browser.close();
        return [];
    }
}

/**
 * Extraherar bildmetadata (fotograf, copyright, datum)
 */
function extractImageMetadata(imagePath) {
    // TODO: Implementera EXIF-läsning för mer avancerad metadata
    return {
        url: imagePath,
        alt: path.basename(imagePath, path.extname(imagePath)),
        photographer: null,
        copyright: null,
        date: null,
        caption: null
    };
}

/**
 * Formaterar TSEK till läsbart format
 */
function formatTSEK(value) {
    if (value === null || value === undefined) return 'N/A';
    const num = parseFloat(value);
    if (isNaN(num)) return 'N/A';
    if (Math.abs(num) >= 1000) {
        return `${(num / 1000).toFixed(1)} MSEK`;
    }
    return `${num.toFixed(0)} TSEK`;
}

/**
 * Hämtar värde från bokslut
 */
function getAccountValue(accounts, code) {
    if (!accounts) return null;
    const acc = accounts.find(a => a.code === code);
    return acc ? acc.amount : null;
}

/**
 * Skapar faktaruta från allabolag-data
 * Tar hänsyn till nyare uppgifter från artikeln
 */
function createFactbox(allabolagData, articleData = {}) {
    if (!allabolagData || !allabolagData.company) {
        return null;
    }

    const d = allabolagData.company;
    const latestAccounts = d.companyAccounts?.[0]?.accounts || [];

    const factbox = {
        companyName: d.name || 'Okänt',
        orgnr: d.orgnr || 'N/A',
        foundationYear: d.foundationYear || 'N/A',
        municipality: d.domicile?.municipality || 'N/A',
        employees: d.numberOfEmployees || 'N/A',
        revenue: formatTSEK(getAccountValue(latestAccounts, 'SDI')),
        profit: formatTSEK(getAccountValue(latestAccounts, 'DR')),
        chairman: d.roles?.chairman?.name || null,
        ceo: null,
        purpose: d.purpose || '',
        website: d.homePage || null,
        industry: d.currentIndustry?.name || null
    };

    // VIKTIGT: Uppdatera med nyare uppgifter från artikeln
    // Detta förhindrar att gammal allabolag-data motsäger nyheten
    if (articleData.newCEO) {
        factbox.ceo = articleData.newCEO;
    }
    if (articleData.newChairman) {
        factbox.chairman = articleData.newChairman;
    }
    if (articleData.newEmployees) {
        factbox.employees = articleData.newEmployees;
    }
    if (articleData.newRevenue) {
        factbox.revenue = articleData.newRevenue;
    }

    return factbox;
}

/**
 * Genererar komplett HTML för artikeln - Impact Loop stil
 */
function generateArticleHTML(options) {
    const {
        title,
        ingress,
        content,
        timestamp,
        factbox,
        logoUrl,
        pressImage,
        persons = [], // LinkedIn-profiler för aktuella personer
        category = 'IMPACT LOOP AVSLÖJAR',
        author = { name: 'Impact Loop', title: 'Redaktionen' },
        availableImages = [] // Tillgängliga pressbilder för bildväljaren
    } = options;

    // Skapa persons data för JavaScript
    const personsJson = JSON.stringify(persons.map(p => ({
        name: p.name,
        title: p.title || p.role,
        company: p.company,
        photoUrl: p.photoUrl,
        profileUrl: p.profileUrl,
        location: p.location
    })));

    const html = `<!DOCTYPE html>
<html lang="sv">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} | Impact Loop</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.7;
            color: #1a1a1a;
            background: #fff;
        }

        /* === HEADER - Impact Loop stil === */
        .site-header {
            background: #D4FF00;
            padding: 15px 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .site-header .logo {
            display: flex;
            align-items: center;
            gap: 30px;
        }
        .site-header .logo-img {
            width: 50px;
            height: 50px;
        }
        .site-header .logo svg {
            width: 50px;
            height: 50px;
        }
        .site-header nav {
            display: flex;
            gap: 25px;
            font-size: 0.9em;
        }
        .site-header nav a {
            color: #000;
            text-decoration: none;
            font-weight: 500;
        }
        .site-header nav a:hover {
            text-decoration: underline;
        }
        .site-header .auth-buttons {
            display: flex;
            gap: 10px;
        }
        .site-header .btn {
            padding: 8px 20px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 500;
            text-decoration: none;
            cursor: pointer;
        }
        .site-header .btn-outline {
            background: transparent;
            border: 1px solid #000;
            color: #000;
        }
        .site-header .btn-dark {
            background: #000;
            border: 1px solid #000;
            color: #fff;
        }

        /* === ARTIKEL === */
        article {
            max-width: 680px;
            margin: 0 auto;
            padding: 40px 20px 60px;
        }
        .category-tag {
            font-size: 0.75em;
            font-weight: 600;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: #555;
            margin-bottom: 15px;
        }
        h1 {
            font-size: 2.4em;
            font-weight: 700;
            line-height: 1.15;
            margin-bottom: 25px;
            letter-spacing: -0.5px;
        }

        /* === PRESSBILD === */
        .pressbild {
            margin: 0 -20px 20px;
        }
        .pressbild img {
            width: 100%;
            display: block;
        }
        .pressbild-meta {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 10px 20px;
            font-size: 0.8em;
            color: #666;
        }
        .pressbild-meta .timestamp {
            font-style: normal;
        }
        .pressbild-meta .caption {
            text-align: right;
            max-width: 60%;
        }
        .pressbild-meta .foto-credit {
            display: block;
            color: #888;
            font-size: 0.9em;
        }

        /* === INGRESS === */
        .ingress {
            font-size: 1.15em;
            font-weight: 600;
            line-height: 1.5;
            margin-bottom: 20px;
            color: #1a1a1a;
        }

        /* === BYLINE === */
        .byline {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 20px 0;
            margin-bottom: 25px;
            border-top: 1px solid #eee;
            border-bottom: 1px solid #eee;
        }
        .byline-avatar {
            width: 45px;
            height: 45px;
            border-radius: 50%;
            background: #ddd;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            color: #666;
            font-size: 0.9em;
        }
        .byline-info {
            flex: 1;
        }
        .byline-name {
            font-weight: 600;
            font-size: 0.95em;
        }
        .byline-title {
            font-size: 0.8em;
            color: #666;
        }
        .byline-arrow {
            font-size: 1.2em;
            color: #999;
        }

        /* === BRÖDTEXT === */
        .article-body p {
            margin-bottom: 20px;
            font-size: 1.05em;
            line-height: 1.75;
        }
        .article-body h2 {
            font-size: 1.25em;
            font-weight: 700;
            margin-top: 35px;
            margin-bottom: 15px;
        }
        .article-body strong {
            font-weight: 600;
        }
        .article-body blockquote {
            margin: 25px 0;
            padding: 0;
            font-style: normal;
            font-size: 1.05em;
            border: none;
        }
        .article-body blockquote p {
            margin-bottom: 5px;
        }
        .article-body a {
            color: #000;
            text-decoration: underline;
            text-decoration-color: #D4FF00;
            text-decoration-thickness: 2px;
            text-underline-offset: 2px;
        }
        .article-body a:hover {
            background: #D4FF00;
        }
        /* === FAKTARUTA (komprimerad) === */
        .faktaruta {
            background: #f8f8f8;
            padding: 15px 20px;
            border-radius: 4px;
            margin-top: 40px;
            font-size: 0.9em;
            line-height: 1.8;
        }
        .faktaruta .logo-inline {
            height: 24px;
            width: auto;
            margin-right: 10px;
            vertical-align: middle;
        }
        .faktaruta .separator {
            color: #bbb;
            margin: 0 6px;
        }
        .faktaruta strong {
            font-weight: 600;
        }

        /* === AKTUELLA PERSONER === */
        .persons-section {
            margin-top: 40px;
            padding-top: 30px;
            border-top: 1px solid #eee;
        }
        .persons-section h3 {
            font-size: 1.1em;
            font-weight: 700;
            margin-bottom: 20px;
            color: #333;
        }
        .persons-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 20px;
        }
        .person-card {
            background: #f8f8f8;
            border-radius: 10px;
            padding: 20px;
            text-align: center;
            transition: all 0.2s ease;
            cursor: pointer;
            text-decoration: none;
            color: inherit;
            display: block;
        }
        .person-card:hover {
            background: #f0f0f0;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .person-photo {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            margin: 0 auto 12px;
            background: #ddd;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .person-photo img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .person-photo .initials {
            font-size: 1.4em;
            font-weight: 600;
            color: #666;
        }
        .person-name {
            font-weight: 600;
            font-size: 0.95em;
            margin-bottom: 4px;
        }
        .person-title {
            font-size: 0.8em;
            color: #666;
            line-height: 1.3;
        }
        .linkedin-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            margin-top: 10px;
            font-size: 0.7em;
            color: #0077b5;
        }
        .linkedin-badge svg {
            width: 14px;
            height: 14px;
        }

        /* === PERSON TOOLTIP (hover i artikeltext) === */
        .person-mention {
            position: relative;
            cursor: pointer;
            border-bottom: 2px dotted #D4FF00;
        }
        .person-tooltip {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            padding: 15px;
            width: 220px;
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: all 0.2s ease;
            pointer-events: none;
            margin-bottom: 10px;
        }
        .person-mention:hover .person-tooltip {
            opacity: 1;
            visibility: visible;
        }
        .person-tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 8px solid transparent;
            border-top-color: white;
        }
        .tooltip-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
        }
        .tooltip-photo {
            width: 45px;
            height: 45px;
            border-radius: 50%;
            background: #eee;
            overflow: hidden;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .tooltip-photo img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .tooltip-photo .initials {
            font-size: 1em;
            font-weight: 600;
            color: #666;
        }
        .tooltip-info .name {
            font-weight: 600;
            font-size: 0.9em;
        }
        .tooltip-info .title {
            font-size: 0.75em;
            color: #666;
        }
        .tooltip-link {
            display: block;
            text-align: center;
            padding: 8px;
            background: #0077b5;
            color: white;
            border-radius: 5px;
            font-size: 0.75em;
            font-weight: 500;
            text-decoration: none;
            margin-top: 10px;
        }
        .tooltip-link:hover {
            background: #005885;
        }

        /* === RELATERADE ARTIKLAR === */
        .read-more {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
        }
        .read-more a {
            display: block;
            margin-bottom: 10px;
            color: #000;
            text-decoration: none;
        }
        .read-more a:hover {
            background: #D4FF00;
        }
        .read-more a span {
            background: #D4FF00;
            padding: 2px 4px;
        }

        /* === NYHETSBREV === */
        .newsletter-box {
            background: #f8f8f8;
            border: 1px solid #eee;
            padding: 30px;
            margin-top: 40px;
            text-align: center;
        }
        .newsletter-box h3 {
            font-size: 1.3em;
            margin-bottom: 20px;
        }
        .newsletter-box form {
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        .newsletter-box input[type="email"] {
            padding: 10px 15px;
            border: 1px solid #ddd;
            border-radius: 4px;
            width: 250px;
        }
        .newsletter-box button {
            background: #D4FF00;
            border: none;
            padding: 10px 25px;
            font-weight: 600;
            cursor: pointer;
        }

        /* === FÖRFATTARE FOOTER === */
        .author-footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 0.9em;
        }
        .author-footer .name {
            font-weight: 600;
        }
        .author-footer .email {
            color: #666;
        }

        /* === ADMIN TOOLS === */
        .admin-tools {
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 1000;
        }
        .admin-toggle {
            width: 48px;
            height: 48px;
            background: #000;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            transition: all 0.2s ease;
        }
        .admin-toggle:hover {
            transform: scale(1.05);
            box-shadow: 0 6px 16px rgba(0,0,0,0.3);
        }
        .admin-toggle svg {
            width: 20px;
            height: 20px;
            color: white;
        }
        .admin-menu {
            position: absolute;
            top: 60px;
            right: 0;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.15);
            width: 280px;
            opacity: 0;
            visibility: hidden;
            transform: translateY(-10px);
            transition: all 0.2s ease;
        }
        .admin-menu.active {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .admin-menu-header {
            padding: 15px 20px;
            border-bottom: 1px solid #eee;
            font-weight: 600;
            font-size: 0.9em;
            color: #333;
        }
        .admin-menu-items {
            padding: 10px 0;
        }
        .admin-menu-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 20px;
            font-size: 0.9em;
            color: #333;
            cursor: pointer;
            transition: background 0.15s ease;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }
        .admin-menu-item:hover {
            background: #f8f8f8;
        }
        .admin-menu-item svg {
            width: 18px;
            height: 18px;
            color: #666;
            flex-shrink: 0;
        }
        .admin-menu-item.has-submenu {
            position: relative;
        }
        .admin-menu-item .arrow {
            margin-left: auto;
            font-size: 12px;
            color: #999;
        }
        .admin-submenu {
            display: none;
            background: #f8f8f8;
            padding: 8px 0;
        }
        .admin-submenu.active {
            display: block;
        }
        .admin-submenu-item {
            display: block;
            padding: 10px 20px 10px 50px;
            font-size: 0.85em;
            color: #555;
            cursor: pointer;
            transition: background 0.15s ease;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
        }
        .admin-submenu-item:hover {
            background: #f0f0f0;
        }

        /* === IMAGE PICKER MODAL === */
        .image-picker-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 2000;
            display: none;
            align-items: center;
            justify-content: center;
        }
        .image-picker-modal.active {
            display: flex;
        }
        .image-picker-content {
            background: white;
            border-radius: 16px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            overflow: hidden;
        }
        .image-picker-header {
            padding: 20px 25px;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .image-picker-header h3 {
            font-size: 1.1em;
            font-weight: 600;
        }
        .image-picker-close {
            width: 32px;
            height: 32px;
            border: none;
            background: #f0f0f0;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .image-picker-close:hover {
            background: #e0e0e0;
        }
        .image-picker-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 15px;
            padding: 20px 25px;
            max-height: 50vh;
            overflow-y: auto;
        }
        .image-option {
            cursor: pointer;
            border-radius: 10px;
            overflow: hidden;
            border: 3px solid transparent;
            transition: all 0.15s ease;
        }
        .image-option:hover {
            border-color: #D4FF00;
        }
        .image-option.selected {
            border-color: #D4FF00;
        }
        .image-option img {
            width: 100%;
            height: 100px;
            object-fit: cover;
            display: block;
        }
        .image-option-caption {
            padding: 8px 10px;
            font-size: 0.75em;
            color: #666;
            background: #f8f8f8;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
    </style>
</head>
<body>
    <!-- HEADER -->
    <header class="site-header">
        <div class="logo">
            <svg viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="25" cy="25" r="24" stroke="#000" stroke-width="2"/>
                <text x="25" y="20" text-anchor="middle" font-size="6" font-weight="bold" fill="#000">IMPACT</text>
                <text x="25" y="35" text-anchor="middle" font-size="6" font-weight="bold" fill="#000">LOOP</text>
            </svg>
            <nav>
                <a href="#">Nyheter</a>
                <a href="#">Investerar-databaser</a>
                <a href="#">Dealflow</a>
                <a href="#">Community</a>
                <a href="#">Nyhetsbrev</a>
                <a href="#">Kontakt</a>
            </nav>
        </div>
        <div class="auth-buttons">
            <a href="#" class="btn btn-outline">Logga in</a>
            <a href="#" class="btn btn-dark">Bli medlem</a>
        </div>
    </header>

    <!-- ADMIN TOOLS -->
    <div class="admin-tools">
        <button class="admin-toggle" id="adminToggle" title="Adminverktyg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        </button>
        <div class="admin-menu" id="adminMenu">
            <div class="admin-menu-header">Adminverktyg</div>
            <div class="admin-menu-items">
                <button class="admin-menu-item" id="adminEmail">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                        <polyline points="22,6 12,13 2,6"></polyline>
                    </svg>
                    Maila företaget
                </button>
                <button class="admin-menu-item" id="adminSlack">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"></path>
                        <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"></path>
                        <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"></path>
                        <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"></path>
                        <path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"></path>
                        <path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"></path>
                        <path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"></path>
                        <path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z"></path>
                    </svg>
                    Dela via Slack
                </button>
                <button class="admin-menu-item has-submenu" id="adminAdjust">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    Justera artikel
                    <span class="arrow">›</span>
                </button>
                <div class="admin-submenu" id="adjustSubmenu">
                    <button class="admin-submenu-item" id="adminShorten">Korta texten</button>
                    <button class="admin-submenu-item" id="adminExpand">Utöka texten</button>
                </div>
                <button class="admin-menu-item" id="adminImage">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                        <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    Välj bild
                </button>
            </div>
        </div>
    </div>

    <!-- IMAGE PICKER MODAL -->
    <div class="image-picker-modal" id="imagePickerModal">
        <div class="image-picker-content">
            <div class="image-picker-header">
                <h3>Välj pressbild</h3>
                <button class="image-picker-close" id="imagePickerClose">✕</button>
            </div>
            <div class="image-picker-grid" id="imagePickerGrid">
                <!-- Images will be inserted here by JavaScript -->
            </div>
        </div>
    </div>

    <article>
        <p class="category-tag">${escapeHtml(category)}</p>
        <h1>${escapeHtml(title)}</h1>

        ${pressImage ? `
        <figure class="pressbild">
            <img src="${escapeHtml(pressImage.src || pressImage.url)}" alt="${escapeHtml(pressImage.alt || '')}">
            <div class="pressbild-meta">
                <span class="timestamp">${escapeHtml(timestamp)}</span>
                <span class="caption">
                    ${pressImage.alt ? escapeHtml(pressImage.alt) : ''}
                    <span class="foto-credit">Foto: pressbild.</span>
                </span>
            </div>
        </figure>
        ` : `
        <div class="pressbild-meta" style="padding: 0; margin-bottom: 20px;">
            <span class="timestamp">${escapeHtml(timestamp)}</span>
        </div>
        `}

        <p class="ingress">${escapeHtml(ingress)}</p>

        <div class="byline">
            <div class="byline-avatar">${author.name.split(' ').map(n => n[0]).join('').substring(0, 2)}</div>
            <div class="byline-info">
                <div class="byline-name">${escapeHtml(author.name)}</div>
                <div class="byline-title">${escapeHtml(author.title)}</div>
            </div>
            <span class="byline-arrow">›</span>
        </div>

        <div class="article-body">
            ${content}
        </div>

        ${factbox ? `
        <div class="faktaruta">
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(factbox.companyName)} logotyp" class="logo-inline" onerror="this.style.display='none'">` : ''}
            <strong>${escapeHtml(factbox.companyName)}</strong>
            <span class="separator">|</span> Orgnr: ${escapeHtml(factbox.orgnr)}
            <span class="separator">|</span> Grundat: ${escapeHtml(factbox.foundationYear)}
            <span class="separator">|</span> Anställda: ${escapeHtml(String(factbox.employees))}
            <span class="separator">|</span> Omsättning: ${escapeHtml(factbox.revenue)}
            <span class="separator">|</span> Resultat: ${escapeHtml(factbox.profit)}
        </div>
        ` : ''}

        ${persons.length > 0 ? `
        <div class="persons-section">
            <h3>Aktuella personer</h3>
            <div class="persons-grid">
                ${persons.map(p => `
                <a href="${p.profileUrl || '#'}" target="_blank" class="person-card" ${!p.profileUrl ? 'onclick="return false;"' : ''}>
                    <div class="person-photo">
                        ${p.photoUrl
                            ? `<img src="${escapeHtml(p.photoUrl)}" alt="${escapeHtml(p.name)}" onerror="this.parentElement.innerHTML='<span class=\\'initials\\'>${getInitials(p.name)}</span>'">`
                            : `<span class="initials">${getInitials(p.name)}</span>`
                        }
                    </div>
                    <div class="person-name">${escapeHtml(p.name)}</div>
                    <div class="person-title">${escapeHtml(p.title || p.role || '')}</div>
                    ${p.profileUrl ? `
                    <span class="linkedin-badge">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                        </svg>
                        Se profil
                    </span>
                    ` : ''}
                </a>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <div class="newsletter-box">
            <h3>Gör som 20 000+ andra impact-ledare och investerare – få vårt nyhetsbrev</h3>
            <form>
                <input type="email" placeholder="Fyll i din företagsmail">
                <button type="submit">Vi kör!</button>
            </form>
        </div>

        <div class="author-footer">
            <span class="name">${escapeHtml(author.name)}</span><br>
            <span class="email">redaktion@loop.se</span>
        </div>
    </article>

    ${persons.length > 0 ? `
    <script>
        // Persondata för tooltips
        const personsData = ${personsJson};

        // Konvertera personnamn i artikeltexten till tooltips
        document.addEventListener('DOMContentLoaded', function() {
            const articleBody = document.querySelector('.article-body');
            if (!articleBody || personsData.length === 0) return;

            personsData.forEach(person => {
                if (!person.name) return;

                // Hitta alla strong-taggar med personens namn
                const strongs = articleBody.querySelectorAll('strong');
                strongs.forEach(strong => {
                    if (strong.textContent.trim() === person.name) {
                        // Skapa tooltip-wrapper
                        const wrapper = document.createElement('span');
                        wrapper.className = 'person-mention';
                        wrapper.setAttribute('data-person', person.name);

                        // Skapa tooltip-innehåll
                        const initials = getInitials(person.name);
                        const photoHtml = person.photoUrl
                            ? '<img src="' + person.photoUrl + '" alt="">'
                            : '<span class="initials">' + initials + '</span>';

                        wrapper.innerHTML = '<strong>' + person.name + '</strong>' +
                            '<div class="person-tooltip">' +
                                '<div class="tooltip-header">' +
                                    '<div class="tooltip-photo">' + photoHtml + '</div>' +
                                    '<div class="tooltip-info">' +
                                        '<div class="name">' + person.name + '</div>' +
                                        '<div class="title">' + (person.title || '') + '</div>' +
                                    '</div>' +
                                '</div>' +
                                (person.profileUrl ? '<a href="' + person.profileUrl + '" target="_blank" class="tooltip-link">Visa LinkedIn-profil</a>' : '') +
                            '</div>';

                        // Ersätt strong-taggen med wrappern
                        strong.parentNode.replaceChild(wrapper, strong);
                    }
                });
            });
        });

        function getInitials(name) {
            if (!name) return '??';
            return name.split(' ').filter(p => p.length > 0).map(p => p[0].toUpperCase()).slice(0, 2).join('');
        }
    </script>
    ` : ''}

    <!-- Admin Tools Script -->
    <script>
        // Tillgängliga pressbilder
        const availableImages = ${JSON.stringify(availableImages)};

        document.addEventListener('DOMContentLoaded', function() {
            // Admin menu toggle
            const adminToggle = document.getElementById('adminToggle');
            const adminMenu = document.getElementById('adminMenu');

            adminToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                adminMenu.classList.toggle('active');
            });

            // Stäng meny vid klick utanför
            document.addEventListener('click', function(e) {
                if (!adminMenu.contains(e.target) && !adminToggle.contains(e.target)) {
                    adminMenu.classList.remove('active');
                }
            });

            // Justera artikel submenu
            const adminAdjust = document.getElementById('adminAdjust');
            const adjustSubmenu = document.getElementById('adjustSubmenu');

            adminAdjust.addEventListener('click', function(e) {
                e.stopPropagation();
                adjustSubmenu.classList.toggle('active');
            });

            // Email-knapp
            document.getElementById('adminEmail').addEventListener('click', function() {
                const companyName = document.querySelector('.faktaruta strong')?.textContent || 'företaget';
                const articleTitle = document.querySelector('h1')?.textContent || '';
                const subject = encodeURIComponent('Begäran om kommentar: ' + articleTitle);
                const body = encodeURIComponent('Hej,\\n\\nImpact Loop har publicerat en artikel om ' + companyName + ' och vi skulle gärna vilja höra er kommentar.\\n\\nLänk till artikeln: ' + window.location.href + '\\n\\nMed vänliga hälsningar,\\nImpact Loop Redaktionen');
                window.open('mailto:?subject=' + subject + '&body=' + body);
                adminMenu.classList.remove('active');
            });

            // Slack-knapp
            document.getElementById('adminSlack').addEventListener('click', function() {
                const articleTitle = document.querySelector('h1')?.textContent || '';
                const text = encodeURIComponent('Ny artikel publicerad: ' + articleTitle + '\\n' + window.location.href);
                // Öppna Slack web-hook eller app
                alert('Slack-integration: Artikeln kommer att delas via Slack-webhook.\\n\\nTitel: ' + articleTitle);
                adminMenu.classList.remove('active');
            });

            // Korta text
            document.getElementById('adminShorten').addEventListener('click', function() {
                alert('AI-förkortning: Artikeltexten kommer att förkortas med ca 30%.\\n\\nDenna funktion kräver server-integration.');
                adminMenu.classList.remove('active');
            });

            // Utöka text
            document.getElementById('adminExpand').addEventListener('click', function() {
                alert('AI-utökning: Artikeltexten kommer att utökas med mer kontext och detaljer.\\n\\nDenna funktion kräver server-integration.');
                adminMenu.classList.remove('active');
            });

            // Bildväljare
            const imagePickerModal = document.getElementById('imagePickerModal');
            const imagePickerGrid = document.getElementById('imagePickerGrid');
            const imagePickerClose = document.getElementById('imagePickerClose');

            document.getElementById('adminImage').addEventListener('click', function() {
                if (availableImages.length === 0) {
                    alert('Inga tillgängliga pressbilder hittades.');
                    return;
                }

                // Populera bildväljaren
                imagePickerGrid.innerHTML = availableImages.map((img, index) => {
                    const isSelected = img.selected ? 'selected' : '';
                    return '<div class="image-option ' + isSelected + '" data-index="' + index + '">' +
                        '<img src="' + img.src + '" alt="' + (img.alt || '') + '">' +
                        '<div class="image-option-caption">' + (img.alt || 'Pressbild ' + (index + 1)) + '</div>' +
                    '</div>';
                }).join('');

                // Lägg till klick-händelser
                imagePickerGrid.querySelectorAll('.image-option').forEach(option => {
                    option.addEventListener('click', function() {
                        const index = parseInt(this.getAttribute('data-index'));
                        const selectedImage = availableImages[index];

                        // Uppdatera pressbild i artikeln
                        const pressbildImg = document.querySelector('.pressbild img');
                        const pressbildCaption = document.querySelector('.pressbild-meta .caption');

                        if (pressbildImg) {
                            pressbildImg.src = selectedImage.src;
                            pressbildImg.alt = selectedImage.alt || '';
                        }
                        if (pressbildCaption) {
                            pressbildCaption.innerHTML = (selectedImage.alt || '') + '<span class="foto-credit">Foto: pressbild.</span>';
                        }

                        // Markera som vald
                        imagePickerGrid.querySelectorAll('.image-option').forEach(opt => opt.classList.remove('selected'));
                        this.classList.add('selected');

                        // Stäng modal
                        imagePickerModal.classList.remove('active');
                        adminMenu.classList.remove('active');
                    });
                });

                imagePickerModal.classList.add('active');
                adminMenu.classList.remove('active');
            });

            imagePickerClose.addEventListener('click', function() {
                imagePickerModal.classList.remove('active');
            });

            imagePickerModal.addEventListener('click', function(e) {
                if (e.target === imagePickerModal) {
                    imagePickerModal.classList.remove('active');
                }
            });
        });
    </script>
</body>
</html>`;

    return html;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Hämtar initialer från ett namn (för avatarer)
 */
function getInitials(name) {
    if (!name) return '??';
    return name
        .split(' ')
        .filter(part => part.length > 0)
        .map(part => part[0].toUpperCase())
        .slice(0, 2)
        .join('');
}

/**
 * Öppnar HTML-fil i standardbrowser
 */
function openInBrowserFn(filePath) {
    const absolutePath = path.resolve(filePath);

    if (process.platform === 'darwin') {
        exec(`open "${absolutePath}"`);
    } else if (process.platform === 'win32') {
        exec(`start "" "${absolutePath}"`);
    } else {
        exec(`xdg-open "${absolutePath}"`);
    }
}

/**
 * Huvudfunktion - Genererar komplett nyhetsartikel
 */
async function generateNewsArticle(options) {
    const {
        orgnr,
        websiteUrl,
        title,
        ingress,
        content,
        articleData = {},
        scrapeImages = true,
        persons = [], // Lista med {name, role, company} för LinkedIn-sökning
        author = { name: 'Impact Loop', title: 'Redaktionen' },
        openInBrowser = true, // Sätt till false för att inte öppna automatiskt
        availableImages = [] // Tillgängliga pressbilder för bildväljaren
    } = options;

    console.log('🚀 Startar Impact Loop nyhetsgenereringsflöde...\n');

    // Skapa output-mapp
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // 1. Hämta Allabolag-data
    console.log('📊 Hämtar företagsdata från Allabolag...');
    const allabolagData = await fetchAllabolagData(orgnr);
    if (allabolagData) {
        console.log(`   ✓ ${allabolagData.company?.name || 'Okänt företag'}`);
    } else {
        console.log('   ⚠ Kunde inte hämta data');
    }

    // 2. Kontrollera logotyp
    console.log('🖼️  Kontrollerar logotyp i Supabase...');
    const logoExists = await checkLogoExists(orgnr);
    const logoUrl = logoExists ? getLogoUrl(orgnr) : null;
    console.log(logoExists ? '   ✓ Logotyp hittad' : '   ⚠ Ingen logotyp');

    // 3. Scrapa pressbilder med Playwright (valfritt)
    let pressImage = null;
    if (scrapeImages && websiteUrl) {
        console.log('📸 Söker pressbilder på hemsidan med Playwright...');
        const images = await scrapePressImages(websiteUrl);
        if (images.length > 0) {
            // Använd första bilden (bästa match)
            pressImage = {
                src: images[0].src,
                alt: images[0].alt || images[0].title || '',
                width: images[0].width,
                height: images[0].height
            };
            console.log(`   ✓ Valde bild: ${pressImage.alt || 'Pressbild'}`);
        } else {
            console.log('   ⚠ Inga passande bilder hittade');
        }
    }

    // 4. Skapa faktaruta
    console.log('📋 Skapar faktaruta...');
    const factbox = createFactbox(allabolagData, articleData);

    // 4.5 Hämta LinkedIn-profiler för aktuella personer
    let linkedInProfiles = [];
    if (persons.length > 0) {
        console.log('👤 Hämtar LinkedIn-profiler...');

        // Lägg till företagsnamn om det saknas
        const personsWithCompany = persons.map(p => ({
            ...p,
            company: p.company || factbox?.companyName || ''
        }));

        // Försök hämta riktiga LinkedIn-profiler, fallback till mock
        const hasLinkedInCookie = process.env.LINKEDIN_COOKIE && process.env.LINKEDIN_COOKIE.length > 0;

        if (hasLinkedInCookie) {
            linkedInProfiles = await getLinkedInProfiles(personsWithCompany);
            console.log(`   ✓ Hämtade ${linkedInProfiles.length} LinkedIn-profil(er)`);
        } else {
            console.log('   ⚠ Ingen LinkedIn-cookie - använder mock-profiler');
            linkedInProfiles = createMockProfiles(personsWithCompany);
        }
    }

    // 5. Generera timestamp
    const now = new Date();
    const timestamp = `${now.toISOString().split('T')[0]} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 6. Generera HTML
    console.log('🌐 Genererar HTML...');
    const html = generateArticleHTML({
        title,
        ingress,
        content,
        timestamp,
        factbox,
        logoUrl,
        pressImage,
        persons: linkedInProfiles,
        author,
        availableImages
    });

    // 7. Spara fil
    const fileName = `${orgnr.replace(/-/g, '')}-${Date.now()}.html`;
    const outputPath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log(`\n✅ Artikel sparad: ${outputPath}`);

    // 8. Öppna i browser (om aktiverat)
    if (openInBrowser) {
        console.log('🌍 Öppnar i webbläsare...');
        openInBrowserFn(outputPath);
    }

    return {
        path: outputPath,
        html,
        factbox,
        logoUrl,
        pressImage,
        allabolagData
    };
}

// CLI-test
if (require.main === module) {
    // Exempel: Testa med Zpark (korrekt format enligt Impact Loop-stil)
    generateNewsArticle({
        orgnr: '559322-0048',
        websiteUrl: 'https://zpark.se',
        title: 'Zpark tar in nya miljoner – värderas till 40 miljoner',
        ingress: 'Det Luleå-baserade laddbolaget Zpark Energy Systems har genomfört en riktad nyemission, kan Impact Loop avslöja. Bolaget värderas nu till drygt 40 miljoner kronor.',
        content: `
            <p>I samband med att Impact Loop gick igenom nya protokoll från Bolagsverket upptäckte vi intressanta uppgifter om <strong>Zpark Energy Systems</strong>. Bolaget, som utvecklar laddlösningar för elfordon, har genomfört en riktad nyemission till ett antal nya investerare. Enligt dokumenten uppgår teckningskursen till 850 kronor per aktie, vilket ger bolaget en implicit värdering på drygt 40 miljoner kronor.</p>

            <p>Zpark grundades 2021 av <strong>Klas Jimmy Abrahamsson</strong> och har sitt säte i Luleå där bolaget driver sin utvecklingsverksamhet. Moderbolaget Tech Invest North AB kvarstår som största ägare efter emissionen. Bolaget har under det senaste räkenskapsåret omsatt 52,7 miljoner kronor och redovisat ett positivt resultat på 1,6 miljoner kronor.</p>

            <p>Med nio anställda och en stark tillväxtkurva positionerar sig Zpark som en intressant aktör inom den snabbt växande marknaden för elbilsladdning i Norden. Bolaget fokuserar på att utveckla och marknadsföra produkter och mjukvara med inriktning mot laddning, uppvärmning och parkering av personbilar.</p>

            <h2>Stark marknadstillväxt</h2>

            <p>Marknaden för laddinfrastruktur växer kraftigt i takt med att försäljningen av elbilar ökar. Enligt branschorganisationen Power Circle installerades över 15 000 nya publika laddpunkter i Sverige under 2024, en ökning med 40 procent jämfört med föregående år. Zpark har positionerat sig inom segmentet för bostadsrättsladdning och företagslösningar.</p>

            <p>Enligt Bolagsverkets handlingar har emissionen riktats till ett flertal investerare, däribland både privatpersoner och bolag med koppling till fastighetsbranschen. Det kan tyda på att Zpark siktar på att expandera sin närvaro inom bostadssegmentet där efterfrågan på laddlösningar ökar i takt med att fler bostadsrättsföreningar vill erbjuda laddning till sina medlemmar.</p>

            <p>Luleå-bolaget är ett av flera svenska företag som satsar på den snabbt växande marknaden för elbilsladdning. Konkurrensen är hård med både etablerade energibolag och nystartade techbolag som kämpar om marknadsandelar. Zparks fokus på mjukvara och integration kan dock ge bolaget en konkurrensfördel gentemot mer hårdvarufokuserade aktörer.</p>
        `,
        articleData: {},
        scrapeImages: true,
        // Aktuella personer för LinkedIn-sektionen
        persons: [
            { name: 'Klas Jimmy Abrahamsson', role: 'Grundare & VD' }
        ],
        author: { name: 'Impact Loop', title: 'Redaktionen' }
    }).catch(console.error);
}

module.exports = {
    generateNewsArticle,
    fetchAllabolagData,
    getLogoUrl,
    checkLogoExists,
    scrapePressImages,
    createFactbox,
    generateArticleHTML,
    openInBrowser: openInBrowserFn
};
