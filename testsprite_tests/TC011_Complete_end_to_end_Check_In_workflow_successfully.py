import asyncio
from playwright import async_api

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",         # Set the browser window size
                "--disable-dev-shm-usage",        # Avoid using /dev/shm which can cause issues in containers
                "--ipc=host",                     # Use host-level IPC for better stability
                "--single-process"                # Run the browser in a single process mode
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        context.set_default_timeout(5000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Navigate to your target URL and wait until the network request is committed
        await page.goto("http://localhost:3000", wait_until="commit", timeout=10000)

        # Wait for the main page to reach DOMContentLoaded state (optional for stability)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=3000)
        except async_api.Error:
            pass

        # Iterate through all iframes and wait for them to load as well
        for frame in page.frames:
            try:
                await frame.wait_for_load_state("domcontentloaded", timeout=3000)
            except async_api.Error:
                pass

        # Interact with the page elements to simulate user flow
        # -> Navigate to http://localhost:3000
        await page.goto("http://localhost:3000", wait_until="commit", timeout=10000)
        
        # -> Select 'Check-In' by touching the welcome screen (click the 'TOUCH ANYWHERE TO START' element).
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=html/body/div/div/div[1]/div[2]/div[1]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        
        # -> Click the 'Use Touch' button (top-right) to switch from voice to touch-driven check-in and proceed to guest identification/ID scan screen.
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=html/body/div/div/div[1]/div[2]/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        
        # -> Click the 'TOUCH ANYWHERE TO START' element to advance to the touch/voice selection screen so the 'Use Touch' option becomes available.
        frame = context.pages[-1]
        # Click element
        elem = frame.locator('xpath=html/body/div/div/div[1]/div[2]/div[1]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        
        # -> Reload the kiosk page (go to http://localhost:3000) to force SPA to reinitialize, then wait for interactive elements to appear and continue by clicking 'TOUCH ANYWHERE TO START' and then 'Use Touch'.
        await page.goto("http://localhost:3000", wait_until="commit", timeout=10000)
        
        # -> Open the kiosk URL in a new tab to force a fresh SPA context, wait for interactive elements to appear, then click 'TOUCH ANYWHERE TO START' and proceed to 'Use Touch' selection.
        await page.goto("http://localhost:3000", wait_until="commit", timeout=10000)
        
        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=Room Key Dispensed').first).to_be_visible(timeout=3000)
        except AssertionError:
            raise AssertionError("Test case failed: The complete check-in flow did not finish successfully — expected the kiosk to display 'Room Key Dispensed' indicating ID scan, reservation verification, payment, and room key dispensing completed, but the confirmation never appeared.")
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    