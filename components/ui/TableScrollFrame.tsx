'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, UIEvent } from 'react';

type TableScrollFrameProps = {
  children: ReactNode;
  totalWidth: number;
  ariaLabel?: string;
};

export function TableScrollFrame({
  children,
  totalWidth,
  ariaLabel = 'Scroll table horizontally',
}: TableScrollFrameProps) {
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  useEffect(() => {
    const tableScroll = tableScrollRef.current;
    if (!tableScroll) return;

    const updateOverflow = () => {
      setHasHorizontalOverflow(tableScroll.scrollWidth > tableScroll.clientWidth + 1);
    };

    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(tableScroll);
    const table = tableScroll.querySelector('table');
    if (table) observer.observe(table);

    return () => observer.disconnect();
  }, [totalWidth]);

  function syncScroll(source: 'table' | 'bottom', event: UIEvent<HTMLDivElement>) {
    if (syncingRef.current) return;

    const target = source === 'table' ? bottomScrollRef.current : tableScrollRef.current;
    if (!target || target.scrollLeft === event.currentTarget.scrollLeft) return;

    syncingRef.current = true;
    target.scrollLeft = event.currentTarget.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  }

  return (
    <div className="table-scroll-frame">
      <div
        className="table-wrap enterprise-table-wrap table-scroll-primary"
        onScroll={(event) => syncScroll('table', event)}
        ref={tableScrollRef}
      >
        {children}
      </div>
      <div
        aria-hidden={!hasHorizontalOverflow}
        aria-label={ariaLabel}
        className={`table-bottom-scroll ${hasHorizontalOverflow ? 'is-visible' : ''}`}
        onScroll={(event) => syncScroll('bottom', event)}
        ref={bottomScrollRef}
        role="region"
        tabIndex={hasHorizontalOverflow ? 0 : -1}
      >
        <div aria-hidden="true" className="table-bottom-scroll-spacer" style={{ width: `${totalWidth}px` }} />
      </div>
    </div>
  );
}

export default TableScrollFrame;
