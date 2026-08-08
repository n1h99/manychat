declare module 'sharp' {
  interface Colour {
    alpha?: number;
    b: number;
    g: number;
    r: number;
  }

  interface CreateInput {
    create: {
      background: Colour;
      channels: 3 | 4;
      height: number;
      width: number;
    };
  }

  interface Metadata {
    height?: number;
    orientation?: number;
    width?: number;
  }

  interface Sharp {
    extend(options: {
      background: Colour;
      bottom: number;
      left: number;
      right: number;
      top: number;
    }): Sharp;
    flatten(options: { background: Colour }): Sharp;
    jpeg(options?: { chromaSubsampling?: string; mozjpeg?: boolean; quality?: number }): Sharp;
    metadata(): Promise<Metadata>;
    png(): Sharp;
    resize(
      width: number,
      height: number,
      options?: {
        background?: Colour;
        fit?: 'contain' | 'cover' | 'fill' | 'inside' | 'outside';
        withoutEnlargement?: boolean;
      },
    ): Sharp;
    rotate(): Sharp;
    toBuffer(): Promise<Buffer>;
    webp(options?: {
      alphaQuality?: number;
      effort?: number;
      quality?: number;
      smartSubsample?: boolean;
    }): Sharp;
  }

  interface SharpOptions {
    failOn?: 'error' | 'none' | 'truncated' | 'warning';
    limitInputPixels?: boolean | number;
  }

  export default function sharp(
    input: ArrayBuffer | CreateInput | Uint8Array,
    options?: SharpOptions,
  ): Sharp;
}
