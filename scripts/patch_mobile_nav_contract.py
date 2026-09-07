from pathlib import Path

nav = Path('components/layout/MobileNavigation.tsx')
text = nav.read_text(encoding='utf-8')
old = """function groupedSections(sections: NavSection[], homePath: string) {\n  const seen = new Set<string>();\n  const featuredPaths = new Set([homePath, '/machines', '/alerts', '/work']);\n  return sections\n    .map((section) => ({\n      ...section,\n      items: section.items.filter((item) => {\n        if (featuredPaths.has(item.href) || seen.has(item.href)) return false;\n        seen.add(item.href);\n        return true;\n      }),\n    }))\n    .filter((section) => section.items.length > 0);\n}\n"""
new = """function groupedSections(sections: NavSection[], homePath: string) {\n  const seen = new Set<string>();\n  return sections\n    .map((section) => ({\n      ...section,\n      items: section.items.filter((item) => {\n        if (item.href === homePath || item.href === '/work' || item.href === '/machines' || item.href === '/alerts' || seen.has(item.href)) return false;\n        seen.add(item.href);\n        return true;\n      }),\n    }))\n    .filter((section) => section.items.length > 0);\n}\n"""
if old not in text:
    raise RuntimeError('Mobile groupedSections source changed unexpectedly')
nav.write_text(text.replace(old, new, 1), encoding='utf-8')

check = Path('scripts/check-mobile-interactions.mjs')
text = check.read_text(encoding='utf-8')
old = "requireSource(mobile, /featuredPaths = new Set\\(\\[homePath, '\\/machines', '\\/alerts', '\\/work'\\]\\)/, 'Featured mobile destinations must not be duplicated in grouped navigation.');"
new = "requireSource(mobile, /item\\.href === homePath \\|\\| item\\.href === '\\/work' \\|\\| item\\.href === '\\/machines' \\|\\| item\\.href === '\\/alerts'/, 'Featured mobile destinations must not be duplicated in grouped navigation.');"
if old not in text:
    raise RuntimeError('Mobile contract assertion changed unexpectedly')
check.write_text(text.replace(old, new, 1), encoding='utf-8')
