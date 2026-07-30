'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePathname } from 'next/navigation';

export type ResizableColumnDefinition = {
  id: string;
  header?: string;
  minWidth?: number;
  defaultWidth?: number;
  maxWidth?: number;
};

type ResizeState = {
  columnId: string;
  startX: number;
  startWidth: number;
};

type PointerLikeEvent = MouseEvent | PointerEvent;

const MIN_COLUMN_WIDTH = 96;
const DEFAULT_COLUMN_WIDTH = 190;
const MAX_COLUMN_WIDTH = 720;

function clampWidth(value: number, minWidth: number, maxWidth: number) {
  return Math.max(minWidth, Math.min(maxWidth, Math.round(value)));
}

function getDefaultWidth(column: ResizableColumnDefinition) {
  if (typeof column.defaultWidth === 'number') return column.defaultWidth;
  const headerLength = column.header?.length ?? column.id.length;
  return clampWidth(120 + headerLength * 7, column.minWidth ?? MIN_COLUMN_WIDTH, column.maxWidth ?? MAX_COLUMN_WIDTH);
}

function storageKey(pathname: string, tableId: string, columns: ResizableColumnDefinition[]) {
  const columnSignature = columns.map((column) => column.id).join('|');
  return `dallmayr-column-widths:${pathname}:${tableId}:${columnSignature}`;
}

export function useResizableColumns(columns: ResizableColumnDefinition[], tableId = 'table') {
  const pathname = usePathname() || 'app';
  const key = useMemo(() => storageKey(pathname, tableId, columns), [columns, pathname, tableId]);
  const resizeState = useRef<ResizeState | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);

  const defaults = useMemo(() => {
    return columns.reduce<Record<string, number>>((acc, column) => {
      acc[column.id] = getDefaultWidth(column);
      return acc;
    }, {});
  }, [columns]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem(key);
      if (!saved) {
        setWidths(defaults);
        return;
      }
      const parsed = JSON.parse(saved) as Record<string, number>;
      const next = columns.reduce<Record<string, number>>((acc, column) => {
        const minWidth = column.minWidth ?? MIN_COLUMN_WIDTH;
        const maxWidth = column.maxWidth ?? MAX_COLUMN_WIDTH;
        acc[column.id] = clampWidth(Number(parsed[column.id] ?? defaults[column.id]), minWidth, maxWidth);
        return acc;
      }, {});
      setWidths(next);
    } catch {
      setWidths(defaults);
    }
  }, [columns, defaults, key]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (Object.keys(widths).length === 0) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(widths));
    } catch {
      // Local storage can be unavailable in private/restricted browser modes.
    }
  }, [key, widths]);

  useEffect(() => {
    return () => {
      resizeState.current = null;
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
      document.body.classList.remove('is-resizing-table-column');
    };
  }, []);

  const totalWidth = useMemo(() => {
    return columns.reduce((total, column) => total + (widths[column.id] ?? defaults[column.id] ?? DEFAULT_COLUMN_WIDTH), 0);
  }, [columns, defaults, widths]);

  const getColumnWidth = useCallback((columnId: string) => {
    return widths[columnId] ?? defaults[columnId] ?? DEFAULT_COLUMN_WIDTH;
  }, [defaults, widths]);

  const setColumnWidth = useCallback((columnId: string, nextWidth: number) => {
    const column = columns.find((item) => item.id === columnId);
    const minWidth = column?.minWidth ?? MIN_COLUMN_WIDTH;
    const maxWidth = column?.maxWidth ?? MAX_COLUMN_WIDTH;
    setWidths((currentWidths) => ({
      ...currentWidths,
      [columnId]: clampWidth(nextWidth, minWidth, maxWidth),
    }));
  }, [columns]);

  const nudgeColumn = useCallback((columnId: string, delta: number) => {
    const column = columns.find((item) => item.id === columnId);
    const minWidth = column?.minWidth ?? MIN_COLUMN_WIDTH;
    const maxWidth = column?.maxWidth ?? MAX_COLUMN_WIDTH;
    setWidths((currentWidths) => {
      const currentWidth = currentWidths[columnId] ?? defaults[columnId] ?? DEFAULT_COLUMN_WIDTH;
      return {
        ...currentWidths,
        [columnId]: clampWidth(currentWidth + delta, minWidth, maxWidth),
      };
    });
  }, [columns, defaults]);

  const resetColumn = useCallback((columnId: string) => {
    setWidths((currentWidths) => ({
      ...currentWidths,
      [columnId]: defaults[columnId] ?? DEFAULT_COLUMN_WIDTH,
    }));
  }, [defaults]);

  const startResize = useCallback((columnId: string, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeState.current = {
      columnId,
      startX: event.clientX,
      startWidth: getColumnWidth(columnId),
    };
    setActiveColumnId(columnId);

    const handleMove = (moveEvent: PointerLikeEvent) => {
      const current = resizeState.current;
      if (!current) return;
      setColumnWidth(current.columnId, current.startWidth + moveEvent.clientX - current.startX);
    };

    resizeCleanupRef.current?.();
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      document.body.classList.remove('is-resizing-table-column');
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null;
    };
    const handleEnd = () => {
      resizeState.current = null;
      setActiveColumnId(null);
      cleanup();
    };

    resizeCleanupRef.current = cleanup;
    document.body.classList.add('is-resizing-table-column');
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  }, [getColumnWidth, setColumnWidth]);

  const resetWidths = useCallback(() => {
    setWidths(defaults);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore local storage reset failures.
      }
    }
  }, [defaults, key]);

  return {
    activeColumnId,
    getColumnWidth,
    nudgeColumn,
    resetColumn,
    resetWidths,
    setColumnWidth,
    startResize,
    totalWidth,
    widths,
  };
}
