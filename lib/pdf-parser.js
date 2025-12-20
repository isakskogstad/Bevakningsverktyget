/**
 * PDF Parser Wrapper
 *
 * Node.js wrapper för parse-lonekollen-pdf.py
 * Anropar Python-skriptet och returnerar parsed JSON.
 */

const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT = path.join(__dirname, '..', 'scripts', 'parse-lonekollen-pdf.py');

/**
 * Parsa en Lönekollen PDF och extrahera inkomstdata
 * @param {string} pdfPath - Sökväg till PDF-filen
 * @param {string} personName - Namn på personen att söka efter
 * @returns {Promise<Object>} - Parsed inkomstdata
 */
async function parseLonekollenPdf(pdfPath, personName) {
    return new Promise((resolve, reject) => {
        const args = [PYTHON_SCRIPT, pdfPath, '--name', personName, '--json'];

        console.log(`[PDFParser] Kör: python3 ${args.join(' ')}`);

        const process = spawn('python3', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code !== 0) {
                console.error(`[PDFParser] Process exited with code ${code}`);
                console.error(`[PDFParser] stderr: ${stderr}`);
                reject(new Error(`PDF parsing failed: ${stderr || 'Unknown error'}`));
                return;
            }

            try {
                const result = JSON.parse(stdout);
                console.log(`[PDFParser] Parsed ${result.inkomster?.length || 0} years for ${result.namn || personName}`);
                resolve(result);
            } catch (parseError) {
                console.error(`[PDFParser] JSON parse error: ${parseError.message}`);
                console.error(`[PDFParser] stdout: ${stdout}`);
                reject(new Error(`Failed to parse JSON output: ${parseError.message}`));
            }
        });

        process.on('error', (err) => {
            console.error(`[PDFParser] Process error: ${err.message}`);
            reject(new Error(`Failed to start Python process: ${err.message}`));
        });

        // Timeout efter 30 sekunder
        setTimeout(() => {
            process.kill();
            reject(new Error('PDF parsing timed out after 30 seconds'));
        }, 30000);
    });
}

/**
 * Kontrollera om PDF-parsern är tillgänglig
 * @returns {Promise<boolean>}
 */
async function checkParserAvailable() {
    return new Promise((resolve) => {
        const process = spawn('python3', ['-c', 'import fitz; print("ok")'], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        process.on('close', (code) => {
            resolve(code === 0);
        });

        process.on('error', () => {
            resolve(false);
        });

        setTimeout(() => {
            process.kill();
            resolve(false);
        }, 5000);
    });
}

module.exports = {
    parseLonekollenPdf,
    checkParserAvailable
};
