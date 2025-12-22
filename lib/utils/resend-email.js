/**
 * Resend Email Service - Plattformsgemensam modul
 *
 * Hanterar:
 * - Skicka e-post
 * - Ta emot/hämta inkommande e-post
 * - Polla efter specifika e-postmeddelanden (t.ex. verifieringskoder)
 *
 * Används av:
 * - Ratsit-scraper (inloggningskoder)
 * - Notifieringar
 * - Andra tjänster som behöver e-posthantering
 *
 * @module resend-email
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_BASE_URL = 'https://api.resend.com';

// E-postadress för automatisering (receiving domain)
// Använder Resends gratis .resend.app domän för att ta emot e-post
const AUTOMATION_EMAIL = process.env.AUTOMATION_EMAIL || 'bevakning@graneidela.resend.app';

/**
 * Skicka e-post via Resend
 * @param {Object} options
 * @param {string} options.to - Mottagare
 * @param {string} options.subject - Ämne
 * @param {string} options.html - HTML-innehåll
 * @param {string} options.text - Textinnehåll (fallback)
 * @param {string} options.from - Avsändare (default: automation email)
 * @returns {Promise<{id: string, success: boolean}>}
 */
async function sendEmail({ to, subject, html, text, from = `Bevakningsverktyget <${AUTOMATION_EMAIL}>` }) {
    // Validera att API-nyckel finns
    if (!RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY saknas! Sätt miljövariabeln RESEND_API_KEY.');
    }
    
    const response = await fetch(`${RESEND_BASE_URL}/emails`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to: Array.isArray(to) ? to : [to],
            subject,
            html,
            text
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Resend error: ${data.message || JSON.stringify(data)}`);
    }

    return { id: data.id, success: true };
}

/**
 * Hämta lista över mottagna e-postmeddelanden
 * @param {Object} options
 * @param {number} options.limit - Max antal (default: 10)
 * @returns {Promise<Array>}
 */
async function listReceivedEmails({ limit = 10 } = {}) {
    const response = await fetch(`${RESEND_BASE_URL}/emails/receiving?limit=${limit}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Resend error: ${data.message || JSON.stringify(data)}`);
    }

    return data.data || [];
}

/**
 * Hämta specifikt mottaget e-postmeddelande
 * @param {string} emailId - E-post-ID
 * @returns {Promise<Object>}
 */
async function getReceivedEmail(emailId) {
    const response = await fetch(`${RESEND_BASE_URL}/emails/receiving/${emailId}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Resend error: ${data.message || JSON.stringify(data)}`);
    }

    return data;
}

/**
 * Polla efter e-post som matchar kriterier
 * Användbart för att vänta på verifieringskoder etc.
 *
 * @param {Object} options
 * @param {string} options.fromContains - Avsändare ska innehålla
 * @param {string} options.subjectContains - Ämne ska innehålla
 * @param {Date} options.after - E-post måste vara nyare än detta datum
 * @param {number} options.timeoutMs - Max väntetid (default: 60000)
 * @param {number} options.pollIntervalMs - Pollningsintervall (default: 3000)
 * @returns {Promise<Object|null>} Matchande e-post eller null vid timeout
 */
async function pollForEmail({
    fromContains,
    subjectContains,
    after = new Date(Date.now() - 60000), // Default: senaste minuten
    timeoutMs = 60000,
    pollIntervalMs = 3000
}) {
    const startTime = Date.now();
    const afterTimestamp = after.getTime();

    console.log(`[ResendEmail] Polling för e-post (from: ${fromContains || '*'}, subject: ${subjectContains || '*'})`);

    while (Date.now() - startTime < timeoutMs) {
        try {
            const emails = await listReceivedEmails({ limit: 20 });

            for (const email of emails) {
                const emailDate = new Date(email.created_at).getTime();

                // Kontrollera om e-posten är tillräckligt ny
                if (emailDate < afterTimestamp) continue;

                // Kontrollera avsändare
                if (fromContains && !email.from?.toLowerCase().includes(fromContains.toLowerCase())) {
                    continue;
                }

                // Kontrollera ämne
                if (subjectContains && !email.subject?.toLowerCase().includes(subjectContains.toLowerCase())) {
                    continue;
                }

                // Matchande e-post hittad!
                console.log(`[ResendEmail] Hittade matchande e-post: ${email.subject}`);

                // Hämta fullständigt innehåll
                const fullEmail = await getReceivedEmail(email.id);
                return fullEmail;
            }
        } catch (error) {
            console.error(`[ResendEmail] Poll error: ${error.message}`);
        }

        // Vänta innan nästa poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    console.log(`[ResendEmail] Timeout - ingen matchande e-post hittades`);
    return null;
}

/**
 * Extrahera verifieringskod från e-postinnehåll
 * Stödjer vanliga format:
 * - 6-siffriga koder
 * - Koder med mellanslag (123 456)
 * - Koder i fetstil eller andra HTML-element
 *
 * @param {string} content - E-postinnehåll (HTML eller text)
 * @returns {string|null} Extraherad kod eller null
 */
function extractVerificationCode(content) {
    if (!content) return null;

    // Ta bort HTML-taggar för enklare parsing
    const textContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

    // Patterns för verifieringskoder
    const patterns = [
        // "Din kod är: 123456" eller "Kod: 123456"
        /(?:kod|code|verifiering)[:\s]+(\d{4,8})/i,

        // "123 456" (med mellanslag)
        /\b(\d{3}\s?\d{3})\b/,

        // Standalone 6-siffrig kod
        /\b(\d{6})\b/,

        // 4-8 siffror efter "inloggning" eller "logga in"
        /(?:inloggning|logga in)[^0-9]*(\d{4,8})/i,
    ];

    for (const pattern of patterns) {
        const match = textContent.match(pattern);
        if (match) {
            // Ta bort eventuella mellanslag från koden
            return match[1].replace(/\s/g, '');
        }
    }

    return null;
}

/**
 * Vänta på och extrahera verifieringskod från e-post
 * Kombinerar pollForEmail och extractVerificationCode
 *
 * @param {Object} options
 * @param {string} options.fromContains - Avsändare (t.ex. 'ratsit')
 * @param {string} options.subjectContains - Ämne (t.ex. 'inloggning')
 * @param {number} options.timeoutMs - Max väntetid
 * @returns {Promise<{code: string, email: Object}|null>}
 */
async function waitForVerificationCode({
    fromContains,
    subjectContains,
    timeoutMs = 60000
}) {
    const afterDate = new Date();

    const email = await pollForEmail({
        fromContains,
        subjectContains,
        after: afterDate,
        timeoutMs,
        pollIntervalMs: 3000
    });

    if (!email) {
        return null;
    }

    // Försök extrahera kod från både HTML och text
    const code = extractVerificationCode(email.html) ||
                 extractVerificationCode(email.text) ||
                 extractVerificationCode(email.body);

    if (code) {
        console.log(`[ResendEmail] Extraherade kod: ${code}`);
        return { code, email };
    }

    console.log(`[ResendEmail] Kunde inte extrahera kod från e-post`);
    return { code: null, email };
}

/**
 * Hämta automation-epostadressen
 * @returns {string}
 */
function getAutomationEmail() {
    return AUTOMATION_EMAIL;
}

module.exports = {
    sendEmail,
    listReceivedEmails,
    getReceivedEmail,
    pollForEmail,
    extractVerificationCode,
    waitForVerificationCode,
    getAutomationEmail,
    AUTOMATION_EMAIL
};
