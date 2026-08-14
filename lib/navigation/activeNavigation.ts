export function isNavigationPathMatch(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

export function selectActiveNavigationHref(pathname: string, hrefs: string[]) {
  const matches = hrefs.filter((href) => isNavigationPathMatch(pathname, href));
  if (!matches.length) return null;

  return matches.sort((left, right) => {
    const exactDifference = Number(right === pathname) - Number(left === pathname);
    if (exactDifference !== 0) return exactDifference;
    return right.length - left.length;
  })[0] ?? null;
}
