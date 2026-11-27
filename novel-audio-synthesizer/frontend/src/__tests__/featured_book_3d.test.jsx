import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as THREE from 'three';
import {
  createFrontCoverTexture,
  createSpineTexture,
} from '../components/3d/bookTextures';
import FeaturedBook3D from '../components/3d/FeaturedBook3D';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal();
  class MockWebGLRenderer {
    constructor() {
      this.outputColorSpace = actual.SRGBColorSpace;
      this.toneMapping = actual.ACESFilmicToneMapping;
      this.toneMappingExposure = 1;
    }
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

function createMock2DContext() {
  const textCalls = [];
  const rectCalls = [];
  let state = {
    tx: 0,
    ty: 0,
    angle: 0,
    font: '16px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    textAlign: 'left',
    lineWidth: 1,
  };
  const stack = [];

  const parseFontSize = (fontStr) => {
    const match = /(\d+(?:\.\d+)?)px/.exec(String(fontStr || ''));
    return match ? Number(match[1]) : 16;
  };

  const makeGradient = () => ({ addColorStop: vi.fn() });

  const ctx = {
    textCalls,
    rectCalls,
    get font() {
      return state.font;
    },
    set font(v) {
      state.font = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v) {
      state.strokeStyle = v;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(v) {
      state.textAlign = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v) {
      state.lineWidth = v;
    },
    save: vi.fn(() => {
      stack.push({ ...state });
    }),
    restore: vi.fn(() => {
      if (stack.length > 0) {
        state = stack.pop();
      }
    }),
    translate: vi.fn((x, y) => {
      state.tx += x;
      state.ty += y;
    }),
    rotate: vi.fn((rad) => {
      state.angle += rad;
    }),
    scale: vi.fn(),
    createRadialGradient: vi.fn(makeGradient),
    createLinearGradient: vi.fn(makeGradient),
    fillRect: vi.fn((x, y, w, h) => {
      rectCalls.push({ x, y, w, h, tx: state.tx, ty: state.ty });
    }),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn((text) => {
      const fontSize = parseFontSize(state.font);
      return { width: String(text || '').length * fontSize * 0.62 };
    }),
    fillText: vi.fn((text, x, y, maxWidth) => {
      const fontSize = parseFontSize(state.font);
      const estimatedWidth = String(text || '').length * fontSize * 0.62;
      const clampedWidth = maxWidth ? Math.min(estimatedWidth, maxWidth) : estimatedWidth;
      textCalls.push({
        text: String(text),
        x,
        y,
        maxWidth,
        fontSize,
        estimatedWidth,
        clampedWidth,
        tx: state.tx,
        ty: state.ty,
        angle: state.angle,
      });
    }),
  };

  return ctx;
}

describe('3D Book Textures & FeaturedBook3D Fallback', () => {
  let active2DCtx;
  let origGetContext;

  beforeEach(() => {
    active2DCtx = null;
    origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(function (type) {
      if (type === '2d') {
        if (!this.__mock2dCtx) {
          this.__mock2dCtx = createMock2DContext();
          active2DCtx = this.__mock2dCtx;
        }
        return this.__mock2dCtx;
      }
      return null;
    });
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = origGetContext;
    vi.restoreAllMocks();
  });

  it('createFrontCoverTexture renders a horizontal 2:3 typographic cover in sRGB', () => {
    const tex = createFrontCoverTexture(
      {
        id: 'sherlock-1',
        title: 'The Adventures of Sherlock Holmes',
        author_username: 'demo_author',
        global_tone: 'Victorian Mystery',
        narrator_name: 'Arthur Neural',
      },
      2
    );

    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.image.width).toBe(512);
    expect(tex.image.height).toBe(768);

    const renderedText = active2DCtx.textCalls.map((c) => c.text).join(' | ');
    expect(renderedText).toContain('VOL. 02  •  SYNCTONE EDITION');
    expect(renderedText).toContain('VICTORIAN MYSTERY');
    expect(renderedText).toContain('BY DEMO_AUTHOR');
    expect(renderedText).toContain('SYNCTONE CLASSICS');

    // Title lines must be horizontal (angle ~ 0) and centered at x=256
    const titleCalls = active2DCtx.textCalls.filter((c) =>
      /ADVENTURES|SHERLOCK|HOLMES/i.test(c.text)
    );
    expect(titleCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of titleCalls) {
      expect(call.angle).toBe(0);
      expect(call.x).toBe(256);
    }

    tex.dispose();
  });

  it('createSpineTexture keeps long titles strictly separated from author text without overlap', () => {
    const tex = createSpineTexture(
      {
        id: 'sherlock-1',
        title: 'The Adventures of Sherlock Holmes',
        author_username: 'demo_author',
      },
      1
    );

    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.image.width).toBe(160);
    expect(tex.image.height).toBe(1024);

    const titleCall = active2DCtx.textCalls.find((c) =>
      c.text.includes('SHERLOCK')
    );
    const authorCall = active2DCtx.textCalls.find((c) =>
      c.text.includes('DEMO_AUTHOR')
    );

    expect(titleCall).toBeDefined();
    expect(authorCall).toBeDefined();

    // Rotated by +90 deg around (80, ty): vertical span is [ty - width/2, ty + width/2]
    expect(titleCall.angle).toBeCloseTo(Math.PI / 2, 5);
    expect(authorCall.angle).toBeCloseTo(Math.PI / 2, 5);

    const titleTop = titleCall.ty - titleCall.clampedWidth / 2;
    const titleBottom = titleCall.ty + titleCall.clampedWidth / 2;
    const authorTop = authorCall.ty - authorCall.clampedWidth / 2;
    const authorBottom = authorCall.ty + authorCall.clampedWidth / 2;

    expect(titleCall.clampedWidth).toBeLessThanOrEqual(440);
    expect(authorCall.clampedWidth).toBeLessThanOrEqual(190);
    // Title must finish well above divider (y=668) and author block (top > 690)
    expect(titleTop).toBeGreaterThan(134);
    expect(titleBottom).toBeLessThan(668);
    expect(authorTop).toBeGreaterThan(668);
    expect(authorBottom).toBeLessThan(930);
    expect(titleBottom).toBeLessThan(authorTop);

    tex.dispose();
  });

  describe('FeaturedBook3D WebGL front cover fallback & TextureLoader handling', () => {
    let origWebGL;
    let origResizeObserver;
    let origIntersectionObserver;
    let origRAF;
    let origCAF;
    let capturedMesh;
    let loaderRequests;

    beforeEach(() => {
      capturedMesh = null;
      loaderRequests = [];

      origWebGL = window.WebGLRenderingContext;
      origResizeObserver = window.ResizeObserver;
      origIntersectionObserver = window.IntersectionObserver;
      origRAF = window.requestAnimationFrame;
      origCAF = window.cancelAnimationFrame;

      window.WebGLRenderingContext = function MockWebGL() {};
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      window.IntersectionObserver = class {
        observe() {}
        disconnect() {}
      };
      window.requestAnimationFrame = vi.fn(() => 1);
      window.cancelAnimationFrame = vi.fn();

      HTMLCanvasElement.prototype.getContext = vi.fn(function (type) {
        if (type === '2d') {
          if (!this.__mock2dCtx) {
            this.__mock2dCtx = createMock2DContext();
          }
          return this.__mock2dCtx;
        }
        if (type === 'webgl' || type === 'experimental-webgl') {
          return {};
        }
        return null;
      });

      vi.spyOn(THREE.Scene.prototype, 'add').mockImplementation(function (obj) {
        if (obj && obj.isMesh && Array.isArray(obj.material)) {
          capturedMesh = obj;
        }
        return this;
      });

      vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(
        (url, onLoad, _onProgress, onError) => {
          loaderRequests.push({ url, onLoad, onError });
          return new THREE.Texture();
        }
      );
    });

    afterEach(() => {
      window.WebGLRenderingContext = origWebGL;
      window.ResizeObserver = origResizeObserver;
      window.IntersectionObserver = origIntersectionObserver;
      window.requestAnimationFrame = origRAF;
      window.cancelAnimationFrame = origCAF;
    });

    it('uses 512x768 createFrontCoverTexture (never spine texture) when cover_object is null', () => {
      render(
        <FeaturedBook3D
          novel={{
            id: 'sherlock',
            title: 'The Adventures of Sherlock Holmes',
            author_username: 'demo_author',
            cover_object: null,
          }}
          volumeIndex={0}
        />
      );

      expect(capturedMesh).not.toBeNull();
      expect(loaderRequests).toHaveLength(0);

      const spineMap = capturedMesh.material[1].map;
      const frontMap = capturedMesh.material[4].map;

      expect(spineMap.image.width).toBe(160);
      expect(spineMap.image.height).toBe(1024);
      expect(frontMap.image.width).toBe(512);
      expect(frontMap.image.height).toBe(768);
      expect(frontMap).not.toBe(spineMap);
    });

    it('keeps typographic front cover fallback on TextureLoader error and upgrades on load', () => {
      render(
        <FeaturedBook3D
          novel={{
            id: 'hp',
            title: "Harry Potter and the Philosopher's Stone",
            author_username: 'jk_rowling',
            cover_object: '/static/covers/broken-cover.jpg',
          }}
          volumeIndex={0}
        />
      );

      expect(loaderRequests).toHaveLength(1);
      const initialFrontMap = capturedMesh.material[4].map;
      const disposeSpy = vi.spyOn(initialFrontMap, 'dispose');

      // Simulate broken image / 404
      loaderRequests[0].onError?.(new Error('404 Not Found'));
      expect(capturedMesh.material[4].map).toBe(initialFrontMap);
      expect(disposeSpy).not.toHaveBeenCalled();

      // Simulate successful load on a subsequent update
      const loadedTex = new THREE.Texture();
      loaderRequests[0].onLoad?.(loadedTex);
      expect(capturedMesh.material[4].map).toBe(loadedTex);
      expect(loadedTex.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('renders graceful NovelCover fallback when WebGL is unavailable and handles click', () => {
    const onSelectNovel = vi.fn();
    render(
      <FeaturedBook3D
        novel={{
          id: 'sherlock-id',
          title: 'The Adventures of Sherlock Holmes',
          author_username: 'demo_author',
          cover_object: null,
        }}
        onSelectNovel={onSelectNovel}
      />
    );

    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    expect(onSelectNovel).toHaveBeenCalledWith('sherlock-id');
  });
});
