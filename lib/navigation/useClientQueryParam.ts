'use client';

import { useEffect, useState } from 'react';

export function useClientQueryParam(name: string) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue(new URLSearchParams(window.location.search).get(name) ?? '');
  }, [name]);

  return value;
}
