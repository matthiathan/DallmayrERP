import type { SVGProps } from 'react';

export type LineIconName =
  | 'alerts'
  | 'building'
  | 'chevron'
  | 'contract'
  | 'customers'
  | 'dashboard'
  | 'equipment'
  | 'grid'
  | 'help'
  | 'inbox'
  | 'inventory'
  | 'messages'
  | 'reports'
  | 'search'
  | 'settings'
  | 'telemetry'
  | 'users'
  | 'work'
  | 'work-orders';

type LineIconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  name: LineIconName;
  size?: number;
};

function pathsFor(name: LineIconName) {
  switch (name) {
    case 'dashboard':
      return <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></>;
    case 'work':
      return <><path d="M9 5h6M9 3h6v4H9zM7 5H5a2 2 0 0 0-2 2v13h18V7a2 2 0 0 0-2-2h-2" /><path d="m8 13 2.2 2.2L16 9.5" /></>;
    case 'inbox':
      return <><path d="M4 5h16v14H4z" /><path d="M4 13h4l2 3h4l2-3h4" /></>;
    case 'alerts':
      return <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>;
    case 'search':
      return <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>;
    case 'customers':
      return <><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-4 2.2-6 5.5-6s5 2 5.5 6" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14c3.2-.5 5 1.2 5.5 4" /></>;
    case 'equipment':
      return <><path d="M14.7 6.3a4 4 0 0 0-5 5L3.5 17.5a2.1 2.1 0 0 0 3 3l6.2-6.2a4 4 0 0 0 5-5l-2.5 2.5-3-3z" /></>;
    case 'work-orders':
      return <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>;
    case 'inventory':
      return <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>;
    case 'reports':
      return <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>;
    case 'messages':
      return <><path d="M4 4h16v12H9l-5 4z" /><path d="M8 8h8M8 12h5" /></>;
    case 'settings':
      return <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>;
    case 'help':
      return <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.5 2.5 0 1 1 3.6 2.2c-.9.5-1.4 1-1.4 2.3M12 17h.01" /></>;
    case 'building':
      return <><path d="M5 21V5h10v16M15 9h4v12M3 21h18" /><path d="M8 8h2M8 12h2M8 16h2M12 8h1M12 12h1M12 16h1" /></>;
    case 'contract':
      return <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 12h6M9 16h6" /></>;
    case 'users':
      return <><circle cx="12" cy="8" r="4" /><path d="M5 21c.5-5 2.8-7 7-7s6.5 2 7 7" /></>;
    case 'telemetry':
      return <><path d="M4 17a8 8 0 0 1 16 0M7 17a5 5 0 0 1 10 0M10 17a2 2 0 0 1 4 0" /><circle cx="12" cy="19" r="1" /></>;
    case 'grid':
      return <><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></>;
    case 'chevron':
      return <><path d="m9 5 7 7-7 7" /></>;
  }
}

export function LineIcon({ name, size = 24, className, ...props }: LineIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {pathsFor(name)}
      </g>
    </svg>
  );
}
