#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from PIL import Image, ImageChops


def changed_ratio(baseline: Image.Image, current: Image.Image, channel_threshold: int) -> tuple[float, Image.Image]:
    if baseline.size != current.size:
        return 1.0, Image.new('RGB', current.size, 'white')

    base = baseline.convert('RGB')
    now = current.convert('RGB')
    diff = ImageChops.difference(base, now)
    pixels = diff.load()
    width, height = diff.size
    changed = 0
    for y in range(height):
        for x in range(width):
            if max(pixels[x, y]) > channel_threshold:
                changed += 1
    return changed / max(1, width * height), diff


def main() -> int:
    parser = argparse.ArgumentParser(description='Compare authenticated production screenshot artifacts.')
    parser.add_argument('baseline', type=Path)
    parser.add_argument('current', type=Path)
    parser.add_argument('--max-change-ratio', type=float, default=0.12)
    parser.add_argument('--channel-threshold', type=int, default=18)
    parser.add_argument('--diff-dir', type=Path, default=Path('artifacts/production-visual/diff'))
    args = parser.parse_args()

    baseline_files = {p.relative_to(args.baseline): p for p in args.baseline.rglob('*.png')}
    current_files = {p.relative_to(args.current): p for p in args.current.rglob('*.png')}
    all_files = sorted(set(baseline_files) | set(current_files))

    args.diff_dir.mkdir(parents=True, exist_ok=True)
    report = []
    failures = []

    for relative in all_files:
        base_path = baseline_files.get(relative)
        current_path = current_files.get(relative)
        if base_path is None or current_path is None:
            report.append({'file': str(relative), 'status': 'missing', 'change_ratio': 1.0})
            failures.append(str(relative))
            continue

        with Image.open(base_path) as baseline, Image.open(current_path) as current:
            ratio, diff = changed_ratio(baseline, current, args.channel_threshold)
            status = 'pass' if ratio <= args.max_change_ratio else 'fail'
            report.append({'file': str(relative), 'status': status, 'change_ratio': round(ratio, 6)})
            if status == 'fail':
                failures.append(str(relative))
                output_path = args.diff_dir / relative
                output_path.parent.mkdir(parents=True, exist_ok=True)
                diff.save(output_path)

    report_path = args.diff_dir / 'comparison.json'
    report_path.write_text(json.dumps({
        'max_change_ratio': args.max_change_ratio,
        'channel_threshold': args.channel_threshold,
        'files': report,
    }, indent=2) + '\n', encoding='utf-8')

    for item in report:
        print(f"{item['status'].upper():7} {item['change_ratio']:.2%} {item['file']}")

    if failures:
        print(f'Visual comparison failed for {len(failures)} screenshot(s).')
        return 1

    print(f'Visual comparison passed for {len(report)} screenshot(s).')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
