with open("frontend/src/components/CalendarView.jsx", "r") as f:
    content = f.read()

import re

# Looks like the button was named differently than my first patch script thought
old_buttons = """          </Tabs>
          <Button
            variant="outline"
            size="sm"
            data-testid="export-pdf-btn"
            onClick={exportPDF}
            className="border-gray-200"
          >
            <FileDown className="w-4 h-4 mr-1" />
            PDF
          </Button>"""

new_buttons = """          </Tabs>
          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(true)}
                className="border-gray-200"
                disabled={selectionMode}
              >
                <Download className="w-4 h-4 mr-1" />
                Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
                className="border-gray-200"
                disabled={selectionMode}
              >
                <Upload className="w-4 h-4 mr-1" />
                Import CSV
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            data-testid="export-pdf-btn"
            onClick={exportPDF}
            className="border-gray-200"
          >
            <FileDown className="w-4 h-4 mr-1" />
            PDF
          </Button>"""

content = content.replace(old_buttons, new_buttons)

with open("frontend/src/components/CalendarView.jsx", "w") as f:
    f.write(content)
