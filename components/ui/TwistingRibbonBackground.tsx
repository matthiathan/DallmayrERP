'use client';

import { useEffect, useRef } from 'react';

type RibbonColors = {
  face?: string;
  foldA?: string;
  foldB?: string;
  foldC?: string;
};

type TwistingRibbonBackgroundProps = {
  segments?: number;
  waveSpeed?: number;
  waveAmplitude?: number;
  twistCycles?: number;
  lightColors?: RibbonColors;
  darkColors?: RibbonColors;
};

type Point = { x: number; y: number };
type Normal = { nx: number; ny: number };

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace(/^#/, '');
  const normalised = cleaned.length === 3
    ? cleaned.split('').map((char) => char + char).join('')
    : cleaned;
  const parsed = Number.parseInt(normalised, 16);
  return [parsed >> 16, (parsed >> 8) & 255, parsed & 255];
}

function lerpColor(a: number[], b: number[], fraction: number) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * fraction),
    Math.round(a[1] + (b[1] - a[1]) * fraction),
    Math.round(a[2] + (b[2] - a[2]) * fraction),
  ];
}

export function TwistingRibbonBackground({
  segments = 360,
  waveSpeed = 0.012,
  waveAmplitude = 0.72,
  twistCycles = 6,
  lightColors,
  darkColors,
}: TwistingRibbonBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasElement = canvas;
    const containerElement = container;
    const context = ctx;

    let animationFrameId = 0;
    let width = containerElement.clientWidth;
    let height = containerElement.clientHeight;
    let time = 0;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ribbonHalfWidth = 14;
    const ribbonXScale = 1.4;
    const ribbonXOffset = 0.2;

    const wave1Frequency = 3.5;
    const wave1TimeSpeed = 0.7;
    const wave1Amplitude = 110 * waveAmplitude;
    const wave2Frequency = 7.0;
    const wave2TimeSpeed = 1.1;
    const wave2Amplitude = 30 * waveAmplitude;
    const twistTimeSpeed = 0.5;

    const lightFace = lightColors?.face ? hexToRgb(lightColors.face) : [255, 60, 10];
    const lightFoldA = lightColors?.foldA ? hexToRgb(lightColors.foldA) : [180, 255, 0];
    const lightFoldB = lightColors?.foldB ? hexToRgb(lightColors.foldB) : [60, 80, 255];
    const lightFoldC = lightColors?.foldC ? hexToRgb(lightColors.foldC) : [0, 220, 255];
    const lightShadow = [80, 60, 40];
    const lightEdge = [0, 0, 0];

    const darkFace = darkColors?.face ? hexToRgb(darkColors.face) : [255, 60, 10];
    const darkFoldA = darkColors?.foldA ? hexToRgb(darkColors.foldA) : [180, 255, 0];
    const darkFoldB = darkColors?.foldB ? hexToRgb(darkColors.foldB) : [60, 80, 255];
    const darkFoldC = darkColors?.foldC ? hexToRgb(darkColors.foldC) : [0, 220, 255];
    const darkShadow = [0, 0, 0];
    const darkEdge = [255, 255, 255];

    const colorCycleFrequency = 2.0;
    const colorCycleSpeed = 0.3;
    const faceBlendGamma = 1.2;
    const shadowOffsetX = 4;
    const shadowOffsetY = 7;
    const edgeMinTwist = 0.08;
    const edgeWeight = 0.5;

    function resize() {
      width = containerElement.clientWidth;
      height = containerElement.clientHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      canvasElement.width = Math.max(1, Math.floor(width * pixelRatio));
      canvasElement.height = Math.max(1, Math.floor(height * pixelRatio));
      canvasElement.style.width = `${width}px`;
      canvasElement.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function buildSpine(currentTime: number) {
      const points: Point[] = [];
      for (let index = 0; index <= segments; index += 1) {
        const progress = index / segments;
        points.push({
          x: progress * width * ribbonXScale - width * ribbonXOffset,
          y:
            height / 2
            + Math.sin(progress * Math.PI * wave1Frequency + currentTime * wave1TimeSpeed) * wave1Amplitude
            + Math.sin(progress * Math.PI * wave2Frequency + currentTime * wave2TimeSpeed) * wave2Amplitude,
        });
      }
      return points;
    }

    function buildNormals(points: Point[]) {
      const last = points.length - 1;
      return points.map((_, index): Normal => {
        const dx = index === 0
          ? points[1].x - points[0].x
          : index === last
            ? points[last].x - points[last - 1].x
            : points[index + 1].x - points[index - 1].x;
        const dy = index === 0
          ? points[1].y - points[0].y
          : index === last
            ? points[last].y - points[last - 1].y
            : points[index + 1].y - points[index - 1].y;
        const length = Math.sqrt(dx * dx + dy * dy) || 1;
        return { nx: -dy / length, ny: dx / length };
      });
    }

    function buildEdges(points: Point[], normals: Normal[], currentTime: number) {
      const tops: Point[] = [];
      const bots: Point[] = [];
      const twists: number[] = [];
      for (let index = 0; index <= segments; index += 1) {
        const twist = Math.cos((index / segments) * Math.PI * twistCycles + currentTime * twistTimeSpeed);
        const ribbonWidth = ribbonHalfWidth * Math.abs(twist);
        const sign = twist >= 0 ? 1 : -1;
        twists.push(twist);
        tops.push({
          x: points[index].x + normals[index].nx * ribbonWidth * sign,
          y: points[index].y + normals[index].ny * ribbonWidth * sign,
        });
        bots.push({
          x: points[index].x - normals[index].nx * ribbonWidth * sign,
          y: points[index].y - normals[index].ny * ribbonWidth * sign,
        });
      }
      return { tops, bots, twists };
    }

    function getFoldColor(fraction: number, currentTime: number, isDark: boolean) {
      const cycle = (((fraction * colorCycleFrequency + currentTime * colorCycleSpeed) % 1) + 1) % 1;
      const colorA = isDark ? darkFoldA : lightFoldA;
      const colorB = isDark ? darkFoldB : lightFoldB;
      const colorC = isDark ? darkFoldC : lightFoldC;

      if (cycle < 1 / 3) return lerpColor(colorA, colorB, cycle * 3);
      if (cycle < 2 / 3) return lerpColor(colorB, colorC, (cycle - 1 / 3) * 3);
      return lerpColor(colorC, colorA, (cycle - 2 / 3) * 3);
    }

    function getRibbonColor(fraction: number, twist: number, currentTime: number, isDark: boolean) {
      const foldColor = getFoldColor(fraction, currentTime, isDark);
      const faceColor = isDark ? darkFace : lightFace;
      const facedness = Math.pow(Math.abs(twist), faceBlendGamma);
      return lerpColor(foldColor, faceColor, facedness);
    }

    function drawQuad(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.lineTo(cx, cy);
      context.lineTo(dx, dy);
      context.closePath();
      context.fill();
    }

    function drawShadow(tops: Point[], bots: Point[], isDark: boolean) {
      const shadow = isDark ? darkShadow : lightShadow;
      const alpha = isDark ? 120 / 255 : 14 / 255;
      context.fillStyle = `rgba(${shadow[0]}, ${shadow[1]}, ${shadow[2]}, ${alpha})`;
      for (let index = 0; index < segments; index += 1) {
        drawQuad(
          tops[index].x + shadowOffsetX,
          tops[index].y + shadowOffsetY,
          tops[index + 1].x + shadowOffsetX,
          tops[index + 1].y + shadowOffsetY,
          bots[index + 1].x + shadowOffsetX,
          bots[index + 1].y + shadowOffsetY,
          bots[index].x + shadowOffsetX,
          bots[index].y + shadowOffsetY,
        );
      }
    }

    function drawRibbon(tops: Point[], bots: Point[], twists: number[], currentTime: number, isDark: boolean) {
      const edgeColor = isDark ? darkEdge : lightEdge;
      const edgeAlpha = isDark ? 30 / 255 : 22 / 255;

      for (let index = 0; index < segments; index += 1) {
        const [red, green, blue] = getRibbonColor(index / segments, twists[index], currentTime, isDark);
        context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
        drawQuad(
          tops[index].x,
          tops[index].y,
          tops[index + 1].x,
          tops[index + 1].y,
          bots[index + 1].x,
          bots[index + 1].y,
          bots[index].x,
          bots[index].y,
        );

        if (Math.abs(twists[index]) > edgeMinTwist) {
          context.strokeStyle = `rgba(${edgeColor[0]}, ${edgeColor[1]}, ${edgeColor[2]}, ${edgeAlpha})`;
          context.lineWidth = edgeWeight;
          context.beginPath();
          context.moveTo(tops[index].x, tops[index].y);
          context.lineTo(tops[index + 1].x, tops[index + 1].y);
          context.stroke();
          context.beginPath();
          context.moveTo(bots[index].x, bots[index].y);
          context.lineTo(bots[index + 1].x, bots[index + 1].y);
          context.stroke();
        }
      }
    }

    function render() {
      context.clearRect(0, 0, width, height);
      time += prefersReducedMotion ? 0 : waveSpeed;
      const isDark = document.documentElement.classList.contains('dark');
      const points = buildSpine(time);
      const normals = buildNormals(points);
      const { tops, bots, twists } = buildEdges(points, normals, time);
      drawShadow(tops, bots, isDark);
      drawRibbon(tops, bots, twists, time, isDark);
      if (!prefersReducedMotion) animationFrameId = requestAnimationFrame(render);
    }

    resize();
    render();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [segments, waveSpeed, waveAmplitude, twistCycles, lightColors, darkColors]);

  return (
    <div ref={containerRef} className="ribbon-app-background" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

export default TwistingRibbonBackground;
