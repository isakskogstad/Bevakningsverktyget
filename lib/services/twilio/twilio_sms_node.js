/**
 * Twilio SMS Service för Node.js
 * Läser inkommande SMS för OTP-koder (3D Secure)
 */

const https = require('https');

// Twilio credentials - läses från miljövariabler
const TWILIO_CONFIG = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || ''
};

if (!TWILIO_CONFIG.accountSid) {
    console.warn('[Twilio] TWILIO_ACCOUNT_SID saknas - sätt miljövariabel eller använd admin-panelen');
}

/**
 * Gör HTTP-anrop till Twilio API
 */
function twilioRequest(path) {
    return new Promise((resolve, reject) => {
        const auth = Buffer.from(`${TWILIO_CONFIG.accountSid}:${TWILIO_CONFIG.authToken}`).toString('base64');

        const options = {
            hostname: 'api.twilio.com',
            port: 443,
            path: `/2010-04-01/Accounts/${TWILIO_CONFIG.accountSid}${path}`,
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

/**
 * Hämtar inkommande SMS-meddelanden
 */
async function listMessages(limit = 10) {
    const path = `/Messages.json?To=${encodeURIComponent(TWILIO_CONFIG.phoneNumber)}&PageSize=${limit}`;
    const response = await twilioRequest(path);
    return response.messages || [];
}

/**
 * Extraherar OTP-kod från SMS-text
 */
function extractOTP(text) {
    if (!text) return null;

    const textLower = text.toLowerCase();

    // Mönster för OTP-koder
    const patterns = [
        // "kod: 123456" eller "code: 123456"
        /(?:kod|code|otp|engångskod|verifieringskod|säkerhetskod)[:\s]+(\d{4,8})/i,
        // "din kod är 123456"
        /(?:din|your)\s+(?:kod|code)\s+(?:är|is)[:\s]+(\d{4,8})/i,
        // Fristående 6-siffrig kod (vanligast)
        /\b(\d{6})\b/,
        // Fristående 4-8 siffrig kod
        /\b(\d{4,8})\b/
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            console.error(`[TWILIO] Extraherade OTP: ${match[1]}`);
            return match[1];
        }
    }

    return null;
}

/**
 * Hämtar senaste OTP-kod från inkommande SMS
 * @param {Date} since - Endast SMS efter detta datum (UTC)
 */
async function getLatestOTP(since = null) {
    const messages = await listMessages(20);

    console.error(`[TWILIO] Kollar ${messages.length} meddelanden, since: ${since ? since.toISOString() : 'null'}`);

    for (const msg of messages) {
        const msgDate = new Date(msg.date_sent);

        // Debug: visa meddelandetid vs since
        console.error(`[TWILIO] SMS från ${msg.from}: "${msg.body.substring(0, 30)}..." tid: ${msgDate.toISOString()}`);

        // Filtrera på datum om angivet
        if (since && msgDate < since) {
            console.error(`[TWILIO] -> Hoppar över (för gammalt)`);
            continue;
        }

        const otp = extractOTP(msg.body);
        if (otp) {
            console.error(`[TWILIO] Hittade OTP: ${otp} från ${msg.from}`);
            return otp;
        }
    }

    return null;
}

/**
 * Väntar en fast tid och hämtar sedan senaste OTP från Twilio
 *
 * @param {number} waitSeconds - Sekunder att vänta innan hämtning (default: 15)
 */
async function waitAndGetOTP(waitSeconds = 15) {
    console.error(`[TWILIO] Väntar ${waitSeconds} sekunder på att SMS ska anlända...`);

    // Vänta den angivna tiden
    await new Promise(r => setTimeout(r, waitSeconds * 1000));

    console.error(`[TWILIO] Hämtar senaste SMS från Twilio...`);

    try {
        // Hämta senaste SMS
        const messages = await listMessages(5);

        if (messages.length === 0) {
            console.error(`[TWILIO] Inga SMS hittade`);
            return null;
        }

        // Ta första meddelandet (senaste)
        const latestMsg = messages[0];
        console.error(`[TWILIO] Senaste SMS: "${latestMsg.body}" från ${latestMsg.from}`);

        // Extrahera OTP
        const otp = extractOTP(latestMsg.body);
        if (otp) {
            console.error(`[TWILIO] Extraherade OTP: ${otp}`);
            return otp;
        } else {
            console.error(`[TWILIO] Kunde inte extrahera OTP från meddelandet`);
            return null;
        }
    } catch (e) {
        console.error(`[TWILIO] Fel vid hämtning: ${e.message}`);
        return null;
    }
}

/**
 * @deprecated Använd waitAndGetOTP istället
 */
async function waitForOTP(timeout = 120, pollInterval = 3) {
    // Använd nya metoden med 15 sekunders väntan
    return await waitAndGetOTP(15);
}

// CLI-test
if (require.main === module) {
    console.log('=== Twilio SMS Service - Test ===\n');

    (async () => {
        console.log('1. Hämtar senaste SMS...');
        const messages = await listMessages(5);

        if (messages.length === 0) {
            console.log('   Inga meddelanden hittade\n');
        } else {
            for (const msg of messages) {
                console.log(`   [${msg.date_sent}] Från: ${msg.from}`);
                console.log(`   Text: ${msg.body}`);
                const otp = extractOTP(msg.body);
                if (otp) console.log(`   -> OTP: ${otp}`);
                console.log('');
            }
        }

        console.log('2. OTP-extraktion test:');
        const testMessages = [
            'Din säkerhetskod är 123456',
            'Your verification code: 789012',
            'OTP: 456789 - giltig i 5 minuter',
            'Använd kod 112233 för att verifiera',
            'Random text utan kod'
        ];

        for (const text of testMessages) {
            const otp = extractOTP(text);
            console.log(`   '${text}' -> OTP: ${otp}`);
        }

        console.log('\n=== Test klart ===');
    })().catch(console.error);
}

module.exports = { listMessages, extractOTP, getLatestOTP, waitForOTP, waitAndGetOTP };
