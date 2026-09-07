from pathlib import Path

shell = Path('components/layout/AppShell.tsx')
text = shell.read_text(encoding='utf-8')
old = '''          <div aria-label={`Current page: ${activeTitle}`} className="application-page-context telemetry-page-context-contract">\n            <span>{activeArea}</span>\n            <strong>{activeTitle}</strong>\n          </div>'''
new = '''          <div aria-label={`Current area: ${activeArea}`} className="application-page-context telemetry-page-context-contract">\n            <span>{activeArea}</span>\n          </div>'''
if old not in text:
    raise RuntimeError('AppShell mobile context changed unexpectedly')
shell.write_text(text.replace(old, new, 1), encoding='utf-8')

check = Path('scripts/check-mobile-interactions.mjs')
text = check.read_text(encoding='utf-8')
old = "requireSource(shell, /<strong>\\{activeTitle\\}<\\/strong>/, 'Mobile header must expose the current page title, not only its section.');\n"
new = "requireSource(shell, /aria-label=\\{`Current area: \\${activeArea}`\\}/, 'Mobile header must preserve area context while the page owns its single h1.');\n"
if old not in text:
    raise RuntimeError('Mobile title assertion changed unexpectedly')
check.write_text(text.replace(old, new, 1), encoding='utf-8')
