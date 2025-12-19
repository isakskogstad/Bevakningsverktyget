/**
 * Protokoll Scraper - Hämtar bolagsstämmoprotokoll från Bolagsverket
 * Använder puppeteer-extra med stealth plugin
 *
 * SÄKERHETSFUNKTIONER:
 * - Daglig gräns på 100 SEK
 * - Loggning av alla köp
 * - Validering innan betalning
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const purchaseLogger = require('../services/purchase_logger');
const twilioSMS = require('../services/twilio_sms_node');

puppeteer.use(StealthPlugin());

// 3D Secure lösenord för kortverifiering
const SECURE_PASSWORD = 'Wdef3579';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Hanterar CAPTCHA om den visas
 * Tar screenshot, läser av koden och fyller i
 */
async function handleCaptcha(page, maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        // Kolla om CAPTCHA visas
        const hasCaptcha = await page.evaluate(() => {
            const text = document.body.innerText || '';
            return text.includes('What code is in the image?') ||
                   text.includes('prevent automated spam') ||
                   text.includes('human visitor');
        });

        if (!hasCaptcha) {
            return true; // Ingen CAPTCHA, fortsätt
        }

        console.error(`[CAPTCHA] Detekterade CAPTCHA (försök ${attempt + 1}/${maxAttempts})`);

        // Ta screenshot av CAPTCHA-bilden
        const captchaScreenshot = `/tmp/captcha_${Date.now()}.png`;
        await page.screenshot({ path: captchaScreenshot, fullPage: true });
        console.error(`[CAPTCHA] Screenshot sparad: ${captchaScreenshot}`);

        // Försök läsa av CAPTCHA-koden från bilden
        // Bilden innehåller typiskt en förvrängd textsträng
        const captchaCode = await page.evaluate(() => {
            // Leta efter CAPTCHA-bilden och försök extrahera alt-text eller andra ledtrådar
            const img = document.querySelector('img');
            if (img && img.alt) return img.alt;

            // Om det finns en audio-knapp, kan vi försöka med den istället
            // Men för nu, returnera null så vi vet att vi behöver manuell avläsning
            return null;
        });

        if (!captchaCode) {
            // Försök extrahera CAPTCHA-bilden och analysera den
            // Spara endast CAPTCHA-bilden (inte hela sidan)
            const captchaImagePath = `/tmp/captcha_image_${Date.now()}.png`;

            try {
                // Hitta CAPTCHA-bilden och spara den separat
                const captchaElement = await page.$('img');
                if (captchaElement) {
                    await captchaElement.screenshot({ path: captchaImagePath });
                    console.error(`[CAPTCHA] CAPTCHA-bild sparad: ${captchaImagePath}`);
                }
            } catch (e) {
                console.error(`[CAPTCHA] Kunde inte spara CAPTCHA-bild: ${e.message}`);
            }

            // När vi kör i --visible läge, vänta på manuell inmatning
            console.error('[CAPTCHA] Väntar på manuell inmatning (30 sek)...');
            console.error('[CAPTCHA] Fyll i CAPTCHA-koden i webbläsaren och klicka submit');

            // Vänta och polla efter att användaren fyllt i
            for (let i = 0; i < 30; i++) {
                await sleep(1000);

                // Kolla om CAPTCHA är löst (sidan har ändrats)
                const stillHasCaptcha = await page.evaluate(() => {
                    const text = document.body.innerText || '';
                    return text.includes('What code is in the image?');
                });

                if (!stillHasCaptcha) {
                    console.error('[CAPTCHA] CAPTCHA löst!');
                    return true;
                }
            }

            console.error('[CAPTCHA] Timeout - CAPTCHA inte löst');
            return false;
        }

        // Fyll i CAPTCHA-koden
        console.error(`[CAPTCHA] Fyller i kod: ${captchaCode}`);
        await page.evaluate((code) => {
            const input = document.querySelector('input[type="text"]');
            if (input) {
                input.value = code;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, captchaCode);

        await sleep(500);

        // Klicka på submit
        await page.evaluate(() => {
            const submitBtn = document.querySelector('input[type="submit"], button');
            if (submitBtn) submitBtn.click();
        });

        await sleep(3000);
    }

    return false;
}

/**
 * Accepterar cookie-dialog om den visas
 */
async function acceptCookies(page, maxWait = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
        try {
            const clicked = await page.evaluate(() => {
                // Bolagsverket cookie-knapp (flera varianter)
                const buttons = Array.from(document.querySelectorAll('button'));
                const cookieBtn = buttons.find(b =>
                    b.textContent.includes('OK') ||
                    b.textContent.includes('Acceptera') ||
                    b.textContent.includes('Godkänn alla kakor') ||
                    b.textContent.includes('Godkänn')
                );
                if (cookieBtn && cookieBtn.offsetParent !== null) {
                    cookieBtn.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                await sleep(1000);
                return true;
            }
        } catch (e) {}

        await sleep(500);
    }

    return false;
}

/**
 * Hämtar senaste bolagsstämmoprotokollet för ett organisationsnummer
 *
 * @param {string} orgnr - Organisationsnummer
 * @param {string} email - E-postadress för leverans
 * @param {object} options - Konfiguration
 * @param {object} options.cardDetails - Kortuppgifter för betalning
 * @param {string} options.cardDetails.number - Kortnummer (16 siffror)
 * @param {string} options.cardDetails.expMonth - Utgångsmånad (01-12)
 * @param {string} options.cardDetails.expYear - Utgångsår (YYYY)
 * @param {string} options.cardDetails.cvv - CVV/CVC (3 siffror)
 * @param {boolean} options.headless - Körs i headless-läge
 * @param {number} options.timeout - Timeout i millisekunder
 * @param {boolean} options.skipPayment - Hoppa över betalning (stoppa vid kassan)
 */
async function fetchProtokoll(orgnr, email, options = {}) {
    const { headless = true, timeout = 120000, cardDetails = null, skipPayment = false } = options;

    // Normalisera orgnr (ta bort bindestreck)
    orgnr = orgnr.replace(/-/g, '').replace(/ /g, '');

    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--lang=sv-SE'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'sv-SE,sv;q=0.9' });

    const steps = [];

    try {
        // Steg 1: Navigera till protokollsidan
        const url = `https://foretagsinfo.bolagsverket.se/sok-foretagsinformation-web/foretag/produkt/PROT/organisationsnummer/${orgnr}`;
        console.error(`Steg 1: Navigerar till ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: timeout
        });
        await sleep(3000);

        // Hantera CAPTCHA om den visas
        const captchaSolved = await handleCaptcha(page);
        if (!captchaSolved) {
            steps.push({ step: 1, status: 'failed', message: 'CAPTCHA kunde inte lösas' });
            return {
                success: false,
                orgnr: orgnr,
                email: email,
                steps: steps,
                error: 'CAPTCHA_FAILED'
            };
        }

        steps.push({ step: 1, status: 'success', message: 'Navigerade till protokollsidan' });

        // Acceptera cookies om de dyker upp
        await acceptCookies(page, 5000);

        // Ta screenshot för debugging
        await page.screenshot({ path: '/tmp/protokoll_1.png' });

        // Steg 2: Välj "Det senast registrerade protokollet"
        console.error('Steg 2: Väljer senaste protokollet');

        const selectedProtokoll = await page.evaluate(() => {
            // Hitta och klicka på första/senaste protokollet
            const rows = document.querySelectorAll('table tbody tr, .protokoll-row, [data-protokoll]');
            if (rows.length > 0) {
                const firstRow = rows[0];
                const radio = firstRow.querySelector('input[type="radio"]');
                if (radio) {
                    radio.click();
                    return true;
                }
                // Alternativt: klicka på raden
                firstRow.click();
                return true;
            }

            // Försök med labels
            const labels = Array.from(document.querySelectorAll('label'));
            const protokollLabel = labels.find(l =>
                l.textContent.includes('senast') ||
                l.textContent.includes('protokoll')
            );
            if (protokollLabel) {
                protokollLabel.click();
                return true;
            }

            return false;
        });

        if (!selectedProtokoll) {
            // Logga sidans innehåll för debugging
            const bodyText = await page.evaluate(() => document.body.innerText);
            console.error('Sidans innehåll:', bodyText.substring(0, 2000));
        }

        await sleep(2000);
        steps.push({ step: 2, status: selectedProtokoll ? 'success' : 'warning', message: 'Väljer senaste protokollet' });

        // Steg 3: Välj digitalt format (PDF)
        console.error('Steg 3: Väljer digitalt format (PDF)');

        const selectedPDF = await page.evaluate(() => {
            // Hitta checkbox/radio för digitalt/PDF
            const inputs = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'));
            const pdfInput = inputs.find(i => {
                const label = i.labels?.[0]?.textContent || '';
                const id = i.id || '';
                const name = i.name || '';
                return label.toLowerCase().includes('digital') ||
                       label.toLowerCase().includes('pdf') ||
                       id.toLowerCase().includes('digital') ||
                       name.toLowerCase().includes('digital');
            });

            if (pdfInput) {
                pdfInput.click();
                return true;
            }

            // Försök med labels direkt
            const labels = Array.from(document.querySelectorAll('label'));
            const pdfLabel = labels.find(l =>
                l.textContent.toLowerCase().includes('digital') ||
                l.textContent.toLowerCase().includes('pdf')
            );
            if (pdfLabel) {
                pdfLabel.click();
                return true;
            }

            return false;
        });

        await sleep(1000);
        await page.screenshot({ path: '/tmp/protokoll_2.png' });
        steps.push({ step: 3, status: selectedPDF ? 'success' : 'warning', message: 'Väljer digitalt format' });

        // Steg 4: Lägg i kundkorgen
        console.error('Steg 4: Lägger i kundkorgen');

        const addedToCart = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
            const cartBtn = buttons.find(b =>
                b.textContent.toLowerCase().includes('lägg i kundkorg') ||
                b.textContent.toLowerCase().includes('kundkorg') ||
                b.textContent.toLowerCase().includes('köp')
            );

            if (cartBtn) {
                cartBtn.click();
                return true;
            }
            return false;
        });

        await sleep(3000);
        await page.screenshot({ path: '/tmp/protokoll_3.png' });
        steps.push({ step: 4, status: addedToCart ? 'success' : 'failed', message: 'Lägger i kundkorgen' });

        // Steg 5: Öppna kundkorgen och gå till kassan
        console.error('Steg 5: Går till kassan');

        // Klicka på kundkorg-ikonen
        const openedCart = await page.evaluate(() => {
            const cartLinks = Array.from(document.querySelectorAll('a, button'));
            const cartLink = cartLinks.find(l =>
                l.textContent.toLowerCase().includes('kundkorg') ||
                l.querySelector('[class*="cart"]') ||
                l.getAttribute('aria-label')?.toLowerCase().includes('korg')
            );

            if (cartLink) {
                cartLink.click();
                return true;
            }
            return false;
        });

        await sleep(2000);

        // Klicka på "Till kassan"
        const wentToCheckout = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const checkoutBtn = buttons.find(b =>
                b.textContent.toLowerCase().includes('till kassan') ||
                b.textContent.toLowerCase().includes('kassa')
            );

            if (checkoutBtn) {
                checkoutBtn.click();
                return true;
            }
            return false;
        });

        await sleep(3000);
        await page.screenshot({ path: '/tmp/protokoll_4.png' });
        steps.push({ step: 5, status: wentToCheckout ? 'success' : 'failed', message: 'Går till kassan' });

        // Steg 6: Acceptera villkor
        console.error('Steg 6: Accepterar villkor');

        const acceptedTerms = await page.evaluate(() => {
            // Hitta checkbox för villkor
            const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
            const termsCheckbox = checkboxes.find(c => {
                const label = c.labels?.[0]?.textContent || '';
                const nearText = c.parentElement?.textContent || '';
                return label.includes('villkor') ||
                       nearText.includes('villkor') ||
                       label.includes('accepterar') ||
                       nearText.includes('accepterar');
            });

            if (termsCheckbox && !termsCheckbox.checked) {
                termsCheckbox.click();
                return true;
            }
            return termsCheckbox?.checked || false;
        });

        await sleep(1000);

        // Klicka på "Nästa"
        const clickedNext = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const nextBtn = buttons.find(b =>
                b.textContent.toLowerCase().includes('nästa') ||
                b.value?.toLowerCase().includes('nästa')
            );

            if (nextBtn) {
                nextBtn.click();
                return true;
            }
            return false;
        });

        await sleep(3000);
        await page.screenshot({ path: '/tmp/protokoll_5.png' });
        steps.push({ step: 6, status: acceptedTerms ? 'success' : 'failed', message: 'Accepterar villkor' });

        // Steg 7: Fyll i e-postadress
        console.error(`Steg 7: Fyller i e-post: ${email}`);

        const filledEmail = await page.evaluate((emailAddr) => {
            const emailInputs = Array.from(document.querySelectorAll('input[type="email"], input[type="text"]'));
            const emailInput = emailInputs.find(i =>
                i.name?.toLowerCase().includes('email') ||
                i.name?.toLowerCase().includes('epost') ||
                i.id?.toLowerCase().includes('email') ||
                i.placeholder?.toLowerCase().includes('e-post') ||
                i.placeholder?.toLowerCase().includes('email')
            );

            if (emailInput) {
                emailInput.value = emailAddr;
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                emailInput.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, email);

        await sleep(1000);
        await page.screenshot({ path: '/tmp/protokoll_6.png', fullPage: true });
        steps.push({ step: 7, status: filledEmail ? 'success' : 'failed', message: 'Fyller i e-post' });

        // Acceptera cookies om dialogen fortfarande visas
        await acceptCookies(page, 3000);

        // Steg 8: Klicka på "Betala" (går till Nets betalningssida)
        console.error('Steg 8: Klickar på Betala');

        const clickedPay = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            const payBtn = buttons.find(b =>
                b.textContent.trim() === 'Betala' ||
                b.textContent.includes('Betala')
            );

            if (payBtn) {
                payBtn.click();
                return true;
            }
            return false;
        });

        await sleep(5000);
        await page.screenshot({ path: '/tmp/protokoll_7.png', fullPage: true });
        steps.push({ step: 8, status: clickedPay ? 'success' : 'failed', message: 'Går till Nets betalning' });

        // Hämta belopp från Nets-sidan
        const paymentInfo = await page.evaluate(() => {
            const text = document.body.innerText;
            const amountMatch = text.match(/Belopp:\s*([\d,]+)\s*\(SEK\)/);
            const orderMatch = text.match(/Ordernummer:\s*(\d+)/);

            return {
                amount: amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : null,
                ordernummer: orderMatch ? orderMatch[1] : null
            };
        });

        console.error(`Belopp: ${paymentInfo.amount} SEK, Order: ${paymentInfo.ordernummer}`);

        // SÄKERHETSKONTROLL: Kontrollera daglig gräns
        if (paymentInfo.amount) {
            const purchaseCheck = purchaseLogger.canPurchase(paymentInfo.amount);
            console.error(`Daglig gräns: ${purchaseCheck.todayTotal}/${purchaseCheck.dailyLimit} SEK`);

            if (!purchaseCheck.allowed) {
                steps.push({
                    step: 9,
                    status: 'blocked',
                    message: `DAGLIG GRÄNS UPPNÅDD! Dagens köp: ${purchaseCheck.todayTotal} SEK. Gräns: ${purchaseCheck.dailyLimit} SEK`
                });

                return {
                    success: false,
                    orgnr: orgnr,
                    email: email,
                    steps: steps,
                    error: 'DAILY_LIMIT_EXCEEDED',
                    dailyTotal: purchaseCheck.todayTotal,
                    dailyLimit: purchaseCheck.dailyLimit,
                    amount: paymentInfo.amount
                };
            }
        }

        // Om skipPayment är true, stoppa här
        if (skipPayment) {
            steps.push({ step: 9, status: 'skipped', message: 'Betalning hoppades över (skipPayment=true)' });

            return {
                success: true,
                orgnr: orgnr,
                email: email,
                steps: steps,
                finalUrl: page.url(),
                amount: paymentInfo.amount,
                ordernummer: paymentInfo.ordernummer,
                paymentSkipped: true
            };
        }

        // Om inga kortuppgifter, stoppa här
        if (!cardDetails || !cardDetails.number) {
            steps.push({ step: 9, status: 'waiting', message: 'Väntar på kortuppgifter' });

            return {
                success: true,
                orgnr: orgnr,
                email: email,
                steps: steps,
                finalUrl: page.url(),
                amount: paymentInfo.amount,
                ordernummer: paymentInfo.ordernummer,
                awaitingPayment: true
            };
        }

        // Steg 9: Fyll i kortuppgifter på Nets
        console.error('Steg 9: Fyller i kortuppgifter');

        // Fyll i kortnummer
        const filledCard = await page.evaluate((cardNum) => {
            // Nets använder ett input-fält för kortnummer
            const cardInput = document.querySelector('input[name="PAN"], input[name="cardNumber"], input#cardNumber');
            if (cardInput) {
                cardInput.focus();
                cardInput.value = cardNum;
                cardInput.dispatchEvent(new Event('input', { bubbles: true }));
                cardInput.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            // Fallback: hitta input med rätt maxlängd
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="tel"]'));
            const cardField = inputs.find(i => i.maxLength >= 16);
            if (cardField) {
                cardField.focus();
                cardField.value = cardNum;
                cardField.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, cardDetails.number);

        await sleep(500);

        // Nets har två select-element: första för månad, andra för år
        // Välj utgångsmånad (första select)
        await page.evaluate((month) => {
            const selects = Array.from(document.querySelectorAll('select'));
            // Första select är för månad (har options 01-12)
            if (selects.length >= 1) {
                const monthSelect = selects[0];
                monthSelect.value = month.padStart(2, '0');
                monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, cardDetails.expMonth);

        await sleep(300);

        // Välj utgångsår (andra select)
        // OBS: Nets kan använda antingen YYYY (2028) eller YY (28) format
        await page.evaluate((year) => {
            const selects = Array.from(document.querySelectorAll('select'));
            // Andra select är för år
            if (selects.length >= 2) {
                const yearSelect = selects[1];
                // Prova först med det givna formatet
                yearSelect.value = year;
                // Om det inte funkade, prova konvertera
                if (!yearSelect.value || yearSelect.value !== year) {
                    // Om year är 4 siffror (2028), konvertera till 2 siffror (28)
                    if (year.length === 4) {
                        yearSelect.value = year.slice(2);
                    }
                    // Om year är 2 siffror (28), konvertera till 4 siffror (2028)
                    else if (year.length === 2) {
                        yearSelect.value = '20' + year;
                    }
                }
                yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, cardDetails.expYear);

        await sleep(300);

        // Fyll i CVV - Nets kallar det SecurityCode
        await page.evaluate((cvv) => {
            // Försök olika selektorer
            const cvvInput = document.querySelector('input[name="SecurityCode"], input[name="CVC"], input[name="CVV"]');
            if (cvvInput) {
                cvvInput.focus();
                cvvInput.value = cvv;
                cvvInput.dispatchEvent(new Event('input', { bubbles: true }));
                cvvInput.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            // Fallback: hitta kort input-fält (3-4 siffror)
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="password"], input[type="tel"]'));
            const cvvField = inputs.find(i => i.maxLength === 3 || i.maxLength === 4);
            if (cvvField) {
                cvvField.focus();
                cvvField.value = cvv;
                cvvField.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, cardDetails.cvv);

        await sleep(1000);
        await page.screenshot({ path: '/tmp/protokoll_8.png', fullPage: true });
        steps.push({ step: 9, status: filledCard ? 'success' : 'warning', message: 'Fyller i kortuppgifter' });

        // Steg 10: Klicka på Betala-knappen på Nets
        console.error('Steg 10: Genomför betalning');

        const completedPayment = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('input[type="submit"], button'));
            const payBtn = buttons.find(b =>
                b.value === 'Betala' ||
                b.textContent?.includes('Betala') ||
                b.name?.toLowerCase().includes('submit')
            );

            if (payBtn) {
                payBtn.click();
                return true;
            }
            return false;
        });

        await sleep(8000);
        await page.screenshot({ path: '/tmp/protokoll_9.png', fullPage: true });

        steps.push({ step: 10, status: 'success', message: 'Klickade på Betala' });

        // Steg 11: Hantera 3D Secure - fylla i lösenord och begära engångskod
        console.error('Steg 11: Hanterar 3D Secure verifiering');

        let currentUrl = page.url();
        let pageText = await page.evaluate(() => document.body.innerText);

        // Kolla om vi är på 3D Secure-sidan (Länsförsäkringar/MasterCard ID Check)
        const is3DSecure = pageText.includes('Signera') ||
                          pageText.includes('MasterCard') ||
                          pageText.includes('BankID') ||
                          pageText.includes('Lösenord') ||
                          pageText.includes('engångskod') ||
                          currentUrl.includes('acs') ||
                          currentUrl.includes('3ds');

        if (is3DSecure) {
            console.error('[3DS] Identifierade 3D Secure-sida');

            // Först: Klicka på "Lösenord och engångskod" om vi är på valsidan
            // Sidan visar två alternativ: "Mobilt BankID" och "Lösenord och engångskod"
            // Vi måste klicka på det andra alternativet

            // Försök hitta och klicka på rätt element
            let clickedPasswordOption = false;

            // Logga HTML-struktur för debugging
            const htmlSnippet = await page.evaluate(() => {
                return document.body.innerHTML.substring(0, 5000);
            });
            console.error('[3DS] HTML-struktur (första 2000 tecken):', htmlSnippet.substring(0, 2000));

            // Metod 1: Hitta den klickbara raden/länken för "Lösenord och engångskod"
            // Ofta är det en <a>, <button>, <div> med onclick, eller en <label>
            clickedPasswordOption = await page.evaluate(() => {
                // Strategi: Hitta SMS-ikonen och klicka på dess förälder-rad
                const images = document.querySelectorAll('img');
                for (const img of images) {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    // SMS-ikonen har ofta "sms" i src eller alt
                    if (src.toLowerCase().includes('sms') || alt.toLowerCase().includes('sms')) {
                        // Klicka på föräldra-elementet (raden)
                        let parent = img.parentElement;
                        for (let i = 0; i < 5 && parent; i++) {
                            parent.click();
                            parent = parent.parentElement;
                        }
                        return 'sms-icon-parent';
                    }
                }

                // Strategi 2: Hitta alla rader/länkar och klicka på den som innehåller texten
                const clickables = document.querySelectorAll('a, button, [role="button"], [onclick], .selectable, .option, .choice');
                for (const el of clickables) {
                    if (el.textContent?.includes('Lösenord och engångskod')) {
                        el.click();
                        return 'clickable-element';
                    }
                }

                // Strategi 3: Leta efter radioknappar eller checkboxar
                const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
                const inputsArray = Array.from(inputs);
                // Välj den andra (index 1) om den finns - "Lösenord" är vanligtvis alternativ 2
                if (inputsArray.length >= 2) {
                    inputsArray[1].click();
                    return 'radio-button';
                }

                // Strategi 4: Klicka på alla element som matchar texten
                const allElements = document.querySelectorAll('*');
                for (const el of allElements) {
                    const text = (el.textContent || '').trim();
                    if (text === 'Lösenord och engångskod') {
                        // Hitta närmaste klickbara förälder
                        let clickTarget = el;
                        while (clickTarget && clickTarget !== document.body) {
                            const style = window.getComputedStyle(clickTarget);
                            if (style.cursor === 'pointer' || clickTarget.onclick || clickTarget.tagName === 'A' || clickTarget.tagName === 'BUTTON') {
                                clickTarget.click();
                                return 'cursor-pointer-parent';
                            }
                            clickTarget = clickTarget.parentElement;
                        }
                        // Fallback: klicka på elementet själv
                        el.click();
                        return 'text-element';
                    }
                }

                return false;
            });

            await sleep(2000);

            // Om första metoden inte fungerade, försök med page.click
            if (!clickedPasswordOption) {
                try {
                    // Försök klicka med olika selektorer
                    const selectors = [
                        'text/Lösenord och engångskod',
                        '[data-method="sms"]',
                        '[data-method="otp"]',
                        '.sms-option',
                        '#sms-auth',
                    ];

                    for (const sel of selectors) {
                        try {
                            await page.click(sel, { timeout: 1000 });
                            clickedPasswordOption = `selector: ${sel}`;
                            break;
                        } catch (e) {
                            // Fortsätt till nästa selektor
                        }
                    }
                } catch (e) {
                    console.error(`[3DS] Selektor-klick misslyckades: ${e.message}`);
                }
            }

            // Metod 3: Klicka på koordinater - hitta den andra raden
            if (!clickedPasswordOption) {
                try {
                    // Hitta positionen för "Lösenord och engångskod" texten
                    const coords = await page.evaluate(() => {
                        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                        while (walker.nextNode()) {
                            if (walker.currentNode.textContent?.includes('Lösenord och engångskod')) {
                                const range = document.createRange();
                                range.selectNode(walker.currentNode);
                                const rect = range.getBoundingClientRect();
                                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                            }
                        }
                        return null;
                    });

                    if (coords && coords.x > 0 && coords.y > 0) {
                        console.error(`[3DS] Klickar på koordinater: (${coords.x}, ${coords.y})`);
                        await page.mouse.click(coords.x, coords.y);
                        clickedPasswordOption = 'coordinates';
                    }
                } catch (e) {
                    console.error(`[3DS] Koordinat-klick misslyckades: ${e.message}`);
                }
            }

            if (clickedPasswordOption) {
                console.error(`[3DS] Klickade på "Lösenord och engångskod" (metod: ${clickedPasswordOption})`);
            } else {
                console.error('[3DS] VARNING: Kunde inte klicka på "Lösenord och engångskod"');
            }

            await sleep(2000);
            await page.screenshot({ path: '/tmp/protokoll_10a_3ds_method.png', fullPage: true });

            // NYTT FLÖDE: Vänta på OTP FÖRST, sedan fyll i lösenord + OTP och bekräfta
            console.error('Steg 12: Väntar på engångskod via Twilio (klickar INGENTING förrän OTP mottagen)...');
            steps.push({ step: 11, status: 'success', message: 'Väntar på SMS-kod' });

            const otp = await twilioSMS.waitForOTP(180, 5); // 180s timeout, 5s intervall

            if (otp) {
                console.error(`[3DS] Mottog OTP: ${otp}`);
                await page.screenshot({ path: '/tmp/protokoll_11_3ds_got_otp.png', fullPage: true });

                // Nu fyller vi i BÅDE engångskod och lösenord
                // VIKTIGT: Formuläret har "Engångskod" FÖRST, sedan "Lösenord"
                console.error(`[3DS] Fyller i Engångskod: ${otp} och Lösenord: Wdef3579`);

                const filledBoth = await page.evaluate((otpCode, password) => {
                    // Hitta alla input-fält
                    const allInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="password"], input[type="tel"], input[type="number"]'));

                    console.log('Hittade input-fält:', allInputs.map(i => ({
                        type: i.type,
                        name: i.name,
                        id: i.id,
                        placeholder: i.placeholder
                    })));

                    let otpField = null;
                    let pwdField = null;

                    // Leta efter fält baserat på namn/id/närliggande label
                    for (const input of allInputs) {
                        const name = (input.name || '').toLowerCase();
                        const id = (input.id || '').toLowerCase();

                        // Kolla om det finns en label för detta fält
                        let labelText = '';
                        const label = document.querySelector(`label[for="${input.id}"]`);
                        if (label) {
                            labelText = label.textContent.toLowerCase();
                        }
                        // Kolla också förälder-element för label-text
                        const parent = input.closest('tr, div');
                        if (parent) {
                            const parentText = parent.textContent.toLowerCase();
                            if (parentText.includes('engångskod') || parentText.includes('sms')) {
                                if (!otpField) otpField = input;
                            }
                            if (parentText.includes('lösenord') || parentText.includes('password')) {
                                if (!pwdField) pwdField = input;
                            }
                        }

                        // Direkt matchning på namn/id
                        if (name.includes('otp') || name.includes('sms') || name.includes('code') || id.includes('otp') || id.includes('sms')) {
                            otpField = input;
                        }
                        if (name.includes('password') || name.includes('pwd') || id.includes('password') || id.includes('pwd') || input.type === 'password') {
                            pwdField = input;
                        }
                    }

                    // Fallback: Om vi har exakt 2 fält, anta att första är OTP och andra är lösenord
                    if (!otpField && !pwdField && allInputs.length === 2) {
                        otpField = allInputs[0];
                        pwdField = allInputs[1];
                    }

                    // Fyll i fälten
                    let filledOTP = false;
                    let filledPwd = false;

                    if (otpField) {
                        otpField.focus();
                        otpField.value = otpCode;
                        otpField.dispatchEvent(new Event('input', { bubbles: true }));
                        otpField.dispatchEvent(new Event('change', { bubbles: true }));
                        filledOTP = true;
                        console.log('Fyllde OTP i fält:', otpField.name || otpField.id);
                    }

                    if (pwdField) {
                        pwdField.focus();
                        pwdField.value = password;
                        pwdField.dispatchEvent(new Event('input', { bubbles: true }));
                        pwdField.dispatchEvent(new Event('change', { bubbles: true }));
                        filledPwd = true;
                        console.log('Fyllde lösenord i fält:', pwdField.name || pwdField.id);
                    }

                    return { filledOTP, filledPwd };
                }, otp, SECURE_PASSWORD);

                console.error(`[3DS] Resultat: OTP=${filledBoth.filledOTP}, Lösenord=${filledBoth.filledPwd}`);

                const filledOTP = filledBoth.filledOTP && filledBoth.filledPwd;

                await sleep(500);
                await page.screenshot({ path: '/tmp/protokoll_12_3ds_filled.png', fullPage: true });

                if (filledOTP) {
                    console.error('[3DS] Fyllde i OTP-kod');

                    // Klicka på "Verifiera" eller "Bekräfta"
                    console.error('[3DS] Klickar på bekräfta-knappen');
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                        const verifyBtn = buttons.find(b => {
                            const text = (b.textContent || b.value || '').toLowerCase();
                            return text.includes('verifiera') ||
                                   text.includes('bekräfta') ||
                                   text.includes('godkänn') ||
                                   text.includes('signera') ||
                                   text.includes('ok') ||
                                   text.includes('submit');
                        });

                        if (verifyBtn) {
                            verifyBtn.click();
                            return true;
                        }

                        // Fallback
                        const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]');
                        if (submitBtn) submitBtn.click();
                    });

                    await sleep(8000);
                    await page.screenshot({ path: '/tmp/protokoll_13_3ds_complete.png', fullPage: true });
                    steps.push({ step: 12, status: 'success', message: `3D Secure verifierad med OTP: ${otp}` });
                } else {
                    steps.push({ step: 12, status: 'failed', message: 'Kunde inte fylla i OTP-fält' });
                }
            } else {
                steps.push({ step: 12, status: 'failed', message: 'Timeout - ingen OTP mottagen via Twilio' });
            }
        } else {
            console.error('[3DS] Ingen 3D Secure-sida detekterad');
            steps.push({ step: 11, status: 'skipped', message: 'Ingen 3D Secure krävdes' });
        }

        // Kontrollera slutresultat
        await sleep(2000);
        let finalUrl = page.url();
        let finalText = await page.evaluate(() => document.body.innerText);
        const paymentSuccess = finalText.toLowerCase().includes('tack') ||
                              finalText.toLowerCase().includes('bekräftelse') ||
                              finalText.toLowerCase().includes('kvitto') ||
                              finalText.toLowerCase().includes('beställning') ||
                              (!finalUrl.includes('nets.eu') && !finalUrl.includes('3ds') && !finalUrl.includes('acs'));

        steps.push({
            step: 13,
            status: paymentSuccess ? 'success' : 'uncertain',
            message: paymentSuccess ? 'Betalning genomförd!' : 'Betalningsstatus oklar'
        });

        // LOGGA KÖPET
        if (paymentSuccess && paymentInfo.amount) {
            purchaseLogger.logPurchase({
                orgnr: orgnr,
                documentType: 'PROTOKOLL',
                amountSEK: paymentInfo.amount,
                ordernummer: paymentInfo.ordernummer,
                email: email,
                status: 'completed',
                paymentMethod: 'card'
            });
        }

        // Steg 14: Klicka på "Din beställning" för att komma till nedladdningssidan
        let downloadedFile = null;

        if (paymentSuccess) {
            console.error('Steg 14: Går till "Din beställning"');

            // Vänta på att bekräftelsesidan laddas helt
            await sleep(3000);
            await page.screenshot({ path: '/tmp/protokoll_13_confirmation.png', fullPage: true });

            // Klicka på "Din beställning" länken
            const clickedOrder = await page.evaluate(() => {
                // Hitta länken "Din beställning"
                const links = Array.from(document.querySelectorAll('a'));
                const orderLink = links.find(a =>
                    a.textContent.toLowerCase().includes('din beställning') ||
                    a.href?.includes('dinbestallning') ||
                    a.href?.includes('order')
                );

                if (orderLink) {
                    orderLink.click();
                    return orderLink.href || true;
                }
                return false;
            });

            if (clickedOrder) {
                console.error('[ORDER] Klickade på "Din beställning"');
                steps.push({ step: 14, status: 'success', message: 'Navigerade till Din beställning' });

                // Vänta på att sidan laddas
                await sleep(5000);
                await page.screenshot({ path: '/tmp/protokoll_14_order_page.png', fullPage: true });

                // Steg 15: Ladda ner PDF-filen
                console.error('Steg 15: Laddar ner protokoll-PDF');

                // Konfigurera nedladdningsmapp
                const downloadPath = '/tmp/protokoll_downloads';
                const fs = require('fs');
                const path = require('path');

                if (!fs.existsSync(downloadPath)) {
                    fs.mkdirSync(downloadPath, { recursive: true });
                }

                // Sätt nedladdningsbeteende
                const client = await page.target().createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: downloadPath
                });

                // Hitta och klicka på PDF-länken
                const pdfLink = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    // Hitta länk som innehåller "Protokoll" och "pdf"
                    const pdfLink = links.find(a => {
                        const text = a.textContent.toLowerCase();
                        const href = (a.href || '').toLowerCase();
                        return (text.includes('protokoll') && (text.includes('pdf') || href.includes('.pdf'))) ||
                               href.includes('protokoll') && href.includes('.pdf');
                    });

                    if (pdfLink) {
                        return {
                            href: pdfLink.href,
                            text: pdfLink.textContent.trim()
                        };
                    }
                    return null;
                });

                if (pdfLink) {
                    console.error(`[PDF] Hittade PDF-länk: ${pdfLink.text}`);

                    // Klicka på PDF-länken för att starta nedladdning
                    await page.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a'));
                        const pdfLink = links.find(a => {
                            const text = a.textContent.toLowerCase();
                            const href = (a.href || '').toLowerCase();
                            return (text.includes('protokoll') && (text.includes('pdf') || href.includes('.pdf'))) ||
                                   href.includes('protokoll') && href.includes('.pdf');
                        });
                        if (pdfLink) pdfLink.click();
                    });

                    // Vänta på nedladdning
                    console.error('[PDF] Väntar på nedladdning...');
                    await sleep(10000);

                    // Kolla om filen laddades ner
                    const files = fs.readdirSync(downloadPath);
                    const pdfFiles = files.filter(f => f.endsWith('.pdf'));

                    if (pdfFiles.length > 0) {
                        // Hitta senaste filen
                        const latestFile = pdfFiles
                            .map(f => ({ name: f, time: fs.statSync(path.join(downloadPath, f)).mtime }))
                            .sort((a, b) => b.time - a.time)[0];

                        downloadedFile = path.join(downloadPath, latestFile.name);
                        console.error(`[PDF] Nedladdad: ${downloadedFile}`);
                        steps.push({ step: 15, status: 'success', message: `PDF nedladdad: ${latestFile.name}` });
                    } else {
                        // Alternativt: Ladda ner via fetch om klick inte fungerade
                        console.error('[PDF] Ingen fil hittad, försöker alternativ nedladdning...');

                        try {
                            const pdfBuffer = await page.evaluate(async (url) => {
                                const response = await fetch(url);
                                const arrayBuffer = await response.arrayBuffer();
                                return Array.from(new Uint8Array(arrayBuffer));
                            }, pdfLink.href);

                            const fileName = `Protokoll_${orgnr}_${new Date().toISOString().split('T')[0]}.pdf`;
                            downloadedFile = path.join(downloadPath, fileName);
                            fs.writeFileSync(downloadedFile, Buffer.from(pdfBuffer));
                            console.error(`[PDF] Nedladdad via fetch: ${downloadedFile}`);
                            steps.push({ step: 15, status: 'success', message: `PDF nedladdad: ${fileName}` });
                        } catch (fetchErr) {
                            console.error(`[PDF] Fetch-nedladdning misslyckades: ${fetchErr.message}`);
                            steps.push({ step: 15, status: 'failed', message: `PDF-nedladdning misslyckades: ${fetchErr.message}` });
                        }
                    }
                } else {
                    console.error('[PDF] Ingen PDF-länk hittad på sidan');

                    // Logga sidans innehåll för debugging
                    const pageContent = await page.evaluate(() => document.body.innerText);
                    console.error('[PDF] Sidans innehåll:', pageContent.substring(0, 1500));

                    steps.push({ step: 15, status: 'waiting', message: 'Ingen PDF-länk hittad - handlingen kanske inte är klar ännu' });
                }

            } else {
                console.error('[ORDER] Kunde inte hitta "Din beställning" länken');
                steps.push({ step: 14, status: 'failed', message: 'Kunde inte hitta "Din beställning" länken' });
            }
        }

        // Uppdatera finalUrl och finalText efter eventuell navigation
        finalUrl = page.url();
        finalText = await page.evaluate(() => document.body.innerText);

        return {
            success: paymentSuccess,
            orgnr: orgnr,
            email: email,
            steps: steps,
            finalUrl: finalUrl,
            amount: paymentInfo.amount,
            ordernummer: paymentInfo.ordernummer,
            paymentCompleted: paymentSuccess,
            downloadedFile: downloadedFile,
            pageContent: finalText.substring(0, 3000)
        };

    } catch (error) {
        await page.screenshot({ path: '/tmp/protokoll_error.png' });
        return {
            success: false,
            orgnr: orgnr,
            email: email,
            error: error.message,
            steps: steps
        };
    } finally {
        await browser.close();
    }
}

// CLI-läge
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.error('Användning: node protokoll-scraper.js <orgnr> <email> [options]');
        console.error('');
        console.error('Options:');
        console.error('  --visible           Visa browser-fönstret');
        console.error('  --skip-payment      Stoppa vid betalningssidan');
        console.error('  --card-number=X     Kortnummer (16 siffror)');
        console.error('  --card-month=X      Utgångsmånad (01-12)');
        console.error('  --card-year=X       Utgångsår (YYYY)');
        console.error('  --card-cvv=X        CVV/CVC (3 siffror)');
        console.error('  --stats             Visa köpstatistik');
        console.error('');
        console.error('Exempel:');
        console.error('  node protokoll-scraper.js 5593220048 isak.skogstad@me.com --visible');
        console.error('  node protokoll-scraper.js 5593220048 isak@me.com --card-number=4111111111111111 --card-month=12 --card-year=2025 --card-cvv=123');
        process.exit(1);
    }

    // Visa statistik
    if (args.includes('--stats')) {
        const stats = purchaseLogger.getStats();
        console.log('=== Köpstatistik ===');
        console.log(JSON.stringify(stats, null, 2));
        process.exit(0);
    }

    const orgnr = args[0];
    const email = args[1];
    const headless = !args.includes('--visible');
    const skipPayment = args.includes('--skip-payment');

    // Parsa kortuppgifter från argument
    const cardDetails = {};
    args.forEach(arg => {
        if (arg.startsWith('--card-number=')) cardDetails.number = arg.split('=')[1];
        if (arg.startsWith('--card-month=')) cardDetails.expMonth = arg.split('=')[1];
        if (arg.startsWith('--card-year=')) cardDetails.expYear = arg.split('=')[1];
        if (arg.startsWith('--card-cvv=')) cardDetails.cvv = arg.split('=')[1];
    });

    const hasCardDetails = cardDetails.number && cardDetails.expMonth && cardDetails.expYear && cardDetails.cvv;

    console.error(`Hämtar protokoll för: ${orgnr}`);
    console.error(`E-post: ${email}`);
    console.error(`Headless: ${headless}`);
    console.error(`Skip payment: ${skipPayment}`);
    console.error(`Kortuppgifter: ${hasCardDetails ? 'JA' : 'NEJ'}`);

    // Visa dagens köpstatus
    const stats = purchaseLogger.getStats();
    console.error(`Dagens köp: ${stats.todaySpentSEK}/${stats.dailyLimitSEK} SEK (${stats.remainingTodaySEK} SEK kvar)`);

    fetchProtokoll(orgnr, email, {
        headless,
        skipPayment,
        cardDetails: hasCardDetails ? cardDetails : null
    })
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch(err => {
            console.error('Fel:', err.message);
            process.exit(1);
        });
}

module.exports = { fetchProtokoll, acceptCookies };
