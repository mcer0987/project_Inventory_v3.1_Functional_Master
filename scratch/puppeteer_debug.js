const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    try {
        console.log("Locating Chrome...");
        let executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        if (!fs.existsSync(executablePath)) {
            executablePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
        }
        if (!fs.existsSync(executablePath)) {
            // Find in playwright folders
            const basePath = `${process.env.USERPROFILE}\\AppData\\Local\\ms-playwright`;
            if (fs.existsSync(basePath)) {
                const dirs = fs.readdirSync(basePath);
                for (const d of dirs) {
                    if (d.startsWith('chromium-')) {
                        const checkPath = `${basePath}\\${d}\\chrome-win\\chrome.exe`;
                        if (fs.existsSync(checkPath)) {
                            executablePath = checkPath;
                            break;
                        }
                    }
                }
            }
        }
        
        console.log("Using browser at:", executablePath);
        
        console.log("Launching Puppeteer...");
        const browser = await puppeteer.launch({
            headless: true,
            executablePath: executablePath
        });
        const page = await browser.newPage();
        
        page.on('console', msg => {
            console.log(`[CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
        });
        
        page.on('pageerror', err => {
            console.error('[PAGE ERROR]', err);
        });

        console.log("Navigating to index.html...");
        await page.goto('http://localhost:5500/index.html');
        
        console.log("Waiting 5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const result = await page.evaluate(() => {
            const body = document.body;
            const lpView = document.getElementById('launchpad-view');
            const invScreen = document.getElementById('inventory-screen');
            const loginModal = document.getElementById('loginModal');
            
            const getInfo = (el, name) => {
                if (!el) return `${name}: NOT FOUND`;
                const style = window.getComputedStyle(el);
                return `${name}: display=${style.display}, visibility=${style.visibility}, opacity=${style.opacity}, classList=[${[...el.classList].join(', ')}], offsetWidth=${el.offsetWidth}, offsetHeight=${el.offsetHeight}`;
            };
            
            return {
                lp: getInfo(lpView, 'launchpad-view'),
                inv: getInfo(invScreen, 'inventory-screen'),
                login: getInfo(loginModal, 'loginModal'),
                bodyClasses: [...body.classList].join(', '),
                bodyHtmlLength: body.innerHTML.length,
                bodyText: body.innerText.substring(0, 500)
            };
        });
        
        console.log("\nInspection Result:");
        console.log(JSON.stringify(result, null, 2));
        
        await browser.close();
    } catch (e) {
        console.error("Failed to run Puppeteer debug script:", e);
    }
})();
