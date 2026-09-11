import type { ByteDecoder } from "@/core/text/byteDecoder";
import { INK_ROLES, type InkRole } from "@/render/hexGrid/byteStyle";

/**
 * Pre-rendered glyph tiles, blitted rather than drawn.
 *
 * Decision D6, taken before the first line of the renderer because retrofitting
 * it means rewriting it. `fillText` costs roughly 2–5 µs a call; a screen of
 * hex is around 1600 cells, which is most of a 16 ms frame spent on text
 * shaping alone. A tile drawn once and copied with `drawImage` is five to ten
 * times cheaper, and the copy cost does not depend on what the glyph is.
 *
 * What is pre-rendered, per ink role:
 *
 * - 16 single hex digits, for the offset column;
 * - 256 two-digit hex pairs, one per byte value — the hex columns;
 * - 256 decoded characters, one per byte value — the text column.
 *
 * That is 528 tiles a role, and a role is a colour: an ordinary byte, a muted
 * fill byte, an unsaved edit, an address, an address's leading zeros. Tiling
 * each colour separately rather than tinting at blit time is the only approach
 * a 2D canvas makes cheap, and 528 small tiles is a canvas of about a thousand
 * device pixels square.
 *
 * The atlas is rebuilt when anything it baked in changes: the font, the size,
 * the theme's colours, the decoding table, or the device pixel ratio. Rebuilding
 * is the cheap operation; blitting is the one in the frame.
 */

/** Everything baked into an atlas. Change any of it and the atlas is stale. */
export interface GlyphAtlasKey {
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly charWidth: number;
  readonly rowHeight: number;
  readonly devicePixelRatio: number;
  /** The resolved colour for each ink role. */
  readonly colors: Readonly<Record<InkRole, string>>;
  /** Which decoding table the text column's glyphs came from. */
  readonly decoderIdentifier: string;
  /** The placeholder character, which is part of that table's rendering. */
  readonly placeholder: string;
}

/** Where one glyph sits in the atlas, in device pixels. */
export interface GlyphTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How many tiles are laid out per atlas row. Keeps the canvas near square. */
const TILES_PER_ROW = 32;

/**
 * A canvas this application can draw a glyph atlas into. `OffscreenCanvas`
 * where it exists — which is everywhere this app supports, and is what lets the
 * atlas be built inside a worker later — and a plain canvas element otherwise.
 */
type AtlasCanvas = OffscreenCanvas | HTMLCanvasElement;

export class GlyphAtlas {
  readonly key: GlyphAtlasKey;

  private readonly canvas: AtlasCanvas;
  /** Tile index → position. Roles are contiguous blocks; see the offsets. */
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  /** The first tile index of each role's block. */
  private readonly roleBase = new Map<InkRole, number>();

  private constructor(
    key: GlyphAtlasKey,
    canvas: AtlasCanvas,
    cellWidth: number,
    cellHeight: number
  ) {
    this.key = key;
    this.canvas = canvas;
    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;
  }

  /** The image to blit from. */
  get source(): CanvasImageSource {
    return this.canvas;
  }

  /**
   * Builds an atlas for `key`, rendering every glyph once.
   *
   * `decoder` supplies the text column's characters, so the atlas and the
   * decoded text column can never disagree about what a byte looks like.
   */
  static build(key: GlyphAtlasKey, decoder: ByteDecoder): GlyphAtlas {
    const scale = key.devicePixelRatio;
    // A cell is as wide as the widest glyph — a two-digit hex pair — so one
    // grid serves all three kinds without a second allocator.
    const cellWidth = Math.ceil(2 * key.charWidth * scale);
    const cellHeight = Math.ceil(key.rowHeight * scale);

    const tilesPerRole = 16 + 256 + 256;
    const totalTiles = tilesPerRole * INK_ROLES.length;
    const rows = Math.ceil(totalTiles / TILES_PER_ROW);

    const canvas = createCanvas(TILES_PER_ROW * cellWidth, rows * cellHeight);
    const context = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (context === null) throw new Error("a 2D context is required to build the glyph atlas");

    const atlas = new GlyphAtlas(key, canvas, cellWidth, cellHeight);

    context.textBaseline = "middle";
    context.textAlign = "left";
    context.font = `${key.fontSizePx * scale}px ${key.fontFamily}`;

    let tile = 0;
    for (const role of INK_ROLES) {
      atlas.roleBase.set(role, tile);
      context.fillStyle = key.colors[role];

      // The offset column's digits.
      for (let digit = 0; digit < 16; digit++) {
        atlas.paint(context, tile++, digit.toString(16).toUpperCase());
      }
      // The hex columns: one tile per byte value, both digits together, so a
      // byte is one blit rather than two.
      for (let byte = 0; byte < 256; byte++) {
        atlas.paint(context, tile++, byte.toString(16).toUpperCase().padStart(2, "0"));
      }
      // The text column.
      for (let byte = 0; byte < 256; byte++) {
        atlas.paint(context, tile++, decoder.decode(byte));
      }
    }

    return atlas;
  }

  /** The tile for one hex digit of an address. */
  digit(value: number, role: InkRole): GlyphTile {
    return this.tileAt((this.roleBase.get(role) ?? 0) + (value & 0xf), this.key.charWidth);
  }

  /** The tile for a byte's two hex digits. */
  hexPair(byte: number, role: InkRole): GlyphTile {
    return this.tileAt((this.roleBase.get(role) ?? 0) + 16 + (byte & 0xff), 2 * this.key.charWidth);
  }

  /** The tile for a byte's decoded character. */
  character(byte: number, role: InkRole): GlyphTile {
    return this.tileAt(
      (this.roleBase.get(role) ?? 0) + 16 + 256 + (byte & 0xff),
      this.key.charWidth
    );
  }

  /** Whether this atlas was built for exactly these parameters. */
  matches(key: GlyphAtlasKey): boolean {
    const mine = this.key;
    return (
      mine.fontFamily === key.fontFamily &&
      mine.fontSizePx === key.fontSizePx &&
      mine.charWidth === key.charWidth &&
      mine.rowHeight === key.rowHeight &&
      mine.devicePixelRatio === key.devicePixelRatio &&
      mine.decoderIdentifier === key.decoderIdentifier &&
      mine.placeholder === key.placeholder &&
      INK_ROLES.every((role) => mine.colors[role] === key.colors[role])
    );
  }

  private paint(
    context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    tile: number,
    text: string
  ): void {
    const column = tile % TILES_PER_ROW;
    const row = Math.floor(tile / TILES_PER_ROW);
    context.fillText(text, column * this.cellWidth, row * this.cellHeight + this.cellHeight / 2);
  }

  /**
   * Where a tile is, in device pixels. `cssWidth` is how wide the glyph
   * actually is, so a single character does not blit the neighbouring one.
   */
  private tileAt(tile: number, cssWidth: number): GlyphTile {
    const column = tile % TILES_PER_ROW;
    const row = Math.floor(tile / TILES_PER_ROW);
    return {
      x: column * this.cellWidth,
      y: row * this.cellHeight,
      width: cssWidth * this.key.devicePixelRatio,
      height: this.cellHeight,
    };
  }
}

function createCanvas(width: number, height: number): AtlasCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
