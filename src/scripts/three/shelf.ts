import {
  Box3,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CASE, COLORS, KEY_LIGHT, SHELF, WALL } from './constants';
import type { JewelCase } from './jewelCase';
import { createBoardShadowTexture } from './textures';

/** Where a shadow lands on the wall per cm between the object and the wall (along the key light) */
const CAST = { x: -KEY_LIGHT.x / KEY_LIGHT.z, y: -KEY_LIGHT.y / KEY_LIGHT.z } as const;

/**
 * A board's shadow on the wall, top to bottom: occlusion above the board, the
 * board itself, then the shadow cast by its front edge (the furthest from the wall)
 */
const BOARD_SHADOW = {
  above: 1.4,
  below: SHELF.depth * -CAST.y,
} as const;
const BOARD_SHADOW_HEIGHT = BOARD_SHADOW.above + SHELF.thickness + BOARD_SHADOW.below;

/** Gap between the back of a case and the wall */
const CASE_TO_WALL = SHELF.caseZ - CASE.depth / 2 - WALL.z;

/** Deterministic noise from the case index, so the "untidy" look is stable */
function noise(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1; // -1..1
}

/**
 * Thick blue boards with the cases standing on them. Rows are generated from
 * the number of covers and the CDs that fit per row. The first row takes the
 * remainder (e.g. 3 on top, 4 below).
 */
export class Shelf {
  readonly group = new Group();
  readonly bounds = new Box3();
  private readonly material = new MeshStandardMaterial({ color: COLORS.shelf, roughness: 0.55, metalness: 0 });
  private boardGeometry?: RoundedBoxGeometry;
  private boards: Mesh[] = [];
  private boardShadows: Mesh[] = [];
  private readonly boardShadowGeometry = new PlaneGeometry(1, 1);
  private readonly boardShadowTexture: Texture;
  private readonly boardShadowMaterial: MeshBasicMaterial;
  private columns = 0;

  constructor(
    private readonly cases: JewelCase[],
    renderer: WebGLRenderer,
  ) {
    for (const jewelCase of cases) this.group.add(jewelCase.shadow, jewelCase.wallShadow);
    this.boardShadowTexture = createBoardShadowTexture(renderer, {
      boardTop: BOARD_SHADOW.above / BOARD_SHADOW_HEIGHT,
      boardBottom: (BOARD_SHADOW.above + SHELF.thickness) / BOARD_SHADOW_HEIGHT,
    });
    this.boardShadowMaterial = new MeshBasicMaterial({
      map: this.boardShadowTexture,
      transparent: true,
      opacity: WALL.boardShadow,
      depthWrite: false,
    });
  }

  /** Lays out rows for a number of columns. Returns false if nothing changed. */
  layout(columns: number): boolean {
    const count = this.cases.length;
    const cols = Math.max(1, Math.min(columns, count));
    if (cols === this.columns) return false;
    this.columns = cols;

    const rows = Math.ceil(count / cols);
    const firstRowCount = count - (rows - 1) * cols;
    const boardWidth = cols * CASE.width + (cols - 1) * SHELF.gap + SHELF.overhang * 2;
    const rowHeight = CASE.height + SHELF.rowGap + SHELF.thickness;

    this.rebuildBoards(rows, boardWidth);

    let caseIndex = 0;
    for (let row = 0; row < rows; row++) {
      const boardTop = -row * rowHeight;
      this.boards[row].position.set(0, boardTop - SHELF.thickness / 2, 0);
      // Shifted along the light by half the board's depth: its average distance to the wall
      this.boardShadows[row].position.set(
        (CAST.x * SHELF.depth) / 2,
        boardTop + BOARD_SHADOW.above - BOARD_SHADOW_HEIGHT / 2,
        WALL.z + 0.01,
      );

      const inRow = row === 0 ? firstRowCount : cols;
      const rowWidth = inRow * CASE.width + (inRow - 1) * SHELF.gap;
      for (let i = 0; i < inRow; i++, caseIndex++) {
        const jewelCase = this.cases[caseIndex];
        const x = -rowWidth / 2 + CASE.width / 2 + i * (CASE.width + SHELF.gap) + noise(caseIndex, 1) * 0.15;
        jewelCase.slot.position.set(x, boardTop + CASE.height / 2 + 0.02, SHELF.caseZ);
        // Minimal variation so it doesn't look like a perfectly aligned mockup
        jewelCase.slot.quaternion.setFromEuler(new Euler(0, noise(caseIndex, 2) * 0.06, noise(caseIndex, 3) * 0.012));
        jewelCase.shadow.position.set(x, boardTop + 0.01, SHELF.caseZ - 0.1);
        // Shows as a soft sliver down its left side; below the board top the board hides it
        jewelCase.wallShadow.position.set(
          x + CAST.x * CASE_TO_WALL,
          jewelCase.slot.position.y + CAST.y * CASE_TO_WALL,
          WALL.z + 0.02,
        );
        jewelCase.wallShadowClip.constant = -boardTop;
      }
    }

    const bottom = -(rows - 1) * rowHeight - SHELF.thickness;
    this.bounds.set(
      new Vector3(-boardWidth / 2, bottom, -SHELF.depth / 2),
      new Vector3(boardWidth / 2, CASE.height, SHELF.depth / 2),
    );
    return true;
  }

  private rebuildBoards(rows: number, width: number) {
    for (const board of this.boards) this.group.remove(board);
    for (const shadow of this.boardShadows) this.group.remove(shadow);
    this.boardGeometry?.dispose();
    this.boardGeometry = new RoundedBoxGeometry(width, SHELF.thickness, SHELF.depth, 4, SHELF.radius);
    this.boards = Array.from({ length: rows }, () => new Mesh(this.boardGeometry, this.material));
    this.boardShadows = Array.from({ length: rows }, () => {
      const shadow = new Mesh(this.boardShadowGeometry, this.boardShadowMaterial);
      // Wider than the board: it's shifted sideways and its ends fade out
      shadow.scale.set(width + Math.abs(CAST.x) * SHELF.depth + 2, BOARD_SHADOW_HEIGHT, 1);
      return shadow;
    });
    this.group.add(...this.boards, ...this.boardShadows);
  }

  dispose() {
    this.boardGeometry?.dispose();
    this.boardShadowGeometry.dispose();
    this.boardShadowTexture.dispose();
    this.boardShadowMaterial.dispose();
    this.material.dispose();
  }
}
