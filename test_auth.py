from playwright.sync_api import sync_playwright
import os

def check_admin():
    os.environ['PWDEBUG'] = '0'  # noqa: S105 - Playwright debug flag, not a credential
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Intercept the /auth/me call to return an admin
        page.route("**/api/auth/me", lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body='{"user_id": "1", "role": "admin", "name": "Admin", "email": "admin@test.com"}'
        ))

        # Intercept other API calls
        page.route("**/api/dashboard/stats", lambda route: route.fulfill(status=200, body='{}'))
        page.route("**/api/schedules**", lambda route: route.fulfill(status=200, body='[]'))
        page.route("**/api/employees**", lambda route: route.fulfill(status=200, body='[]'))
        page.route("**/api/locations**", lambda route: route.fulfill(status=200, body='[]'))
        page.route("**/api/classes**", lambda route: route.fulfill(status=200, body='[]'))
        page.route("**/api/activity-logs**", lambda route: route.fulfill(status=200, body='[]'))

        page.goto("http://localhost:3002/calendar")
        page.wait_for_timeout(2000)

        page.screenshot(path="/home/jules/verification/calendar_intercepted.png")

        export_btn = page.locator('button:has-text("Export CSV")')
        import_btn = page.locator('button:has-text("Import CSV")')

        if export_btn.count() > 0:
            export_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path="/home/jules/verification/export_modal_intercepted.png")
            page.click('button:has-text("Cancel")')
            page.wait_for_timeout(500)

        if import_btn.count() > 0:
            import_btn.click()
            page.wait_for_timeout(1000)
            page.screenshot(path="/home/jules/verification/import_modal_intercepted.png")

        print(f"Export CSV buttons found: {export_btn.count()}")

        browser.close()

if __name__ == "__main__":
    check_admin()
