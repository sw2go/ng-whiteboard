import {
  Component,
  signal,
  computed,
  ElementRef,
  viewChild,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface Point {
  x: number;
  y: number;
}

interface Path {
  id: string;
  points: Point[];
  color: string;
  strokeWidth: number;
}

type Mode = 'draw' | 'pan' | 'erase';

interface TouchInfo {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

@Component({
  selector: 'app-whiteboard',
  imports: [CommonModule, FormsModule],
  templateUrl: './whiteboard.html',
  styleUrl: './whiteboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Whiteboard {
  protected readonly svgElement = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  // State
  protected readonly paths = signal<Path[]>([]);
  protected readonly color = signal('#000000');
  protected readonly strokeWidth = signal(3);
  protected readonly mode = signal<Mode>('draw');

  // View state
  protected readonly viewBoxX = signal(0);
  protected readonly viewBoxY = signal(0);
  protected readonly viewBoxWidth = signal(1000);
  protected readonly viewBoxHeight = signal(1000);
  protected readonly zoom = signal(1);

  // Computed
  protected readonly viewBox = computed(
    () => `${this.viewBoxX()} ${this.viewBoxY()} ${this.viewBoxWidth()} ${this.viewBoxHeight()}`
  );

  // Drawing state
  private currentPath: Path | null = null;
  private isDrawing = false;
  private isPanning = false;

  // Touch state
  private touches = new Map<number, TouchInfo>();
  private initialPinchDistance = 0;
  private initialZoom = 1;
  private pinchCenter: Point | null = null;
  private frozenViewBox: { x: number; y: number; width: number; height: number } | null = null;

  constructor() {
    // Handle window resize
    effect(() => {
      this.handleResize();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.handleResize());
    }
  }

  private handleResize(): void {
    const svg = this.svgElement()?.nativeElement;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const aspectRatio = rect.width / rect.height;
    const baseHeight = 1000;

    this.viewBoxWidth.set(baseHeight * aspectRatio);
    this.viewBoxHeight.set(baseHeight);
  }

  // Coordinate transformation
  private screenToSVG(screenX: number, screenY: number): Point {
    const svg = this.svgElement().nativeElement;
    const rect = svg.getBoundingClientRect();

    const x = this.viewBoxX() + (screenX - rect.left) / rect.width * this.viewBoxWidth();
    const y = this.viewBoxY() + (screenY - rect.top) / rect.height * this.viewBoxHeight();

    return { x, y };
  }

  // Mouse events
  protected onMouseDown(event: MouseEvent): void {
    event.preventDefault();
    const point = this.screenToSVG(event.clientX, event.clientY);

    if (this.mode() === 'draw') {
      this.startDrawing(point);
    } else if (this.mode() === 'pan') {
      this.isPanning = true;
      this.currentPath = { id: '', points: [point], color: '', strokeWidth: 0 };
    } else if (this.mode() === 'erase') {
      this.eraseAtPoint(point);
    }
  }

  protected onMouseMove(event: MouseEvent): void {
    if (!this.isDrawing && !this.isPanning) return;

    event.preventDefault();
    const point = this.screenToSVG(event.clientX, event.clientY);

    if (this.mode() === 'draw' && this.isDrawing) {
      this.continueDrawing(point);
    } else if (this.mode() === 'pan' && this.isPanning && this.currentPath) {
      const lastPoint = this.currentPath.points[this.currentPath.points.length - 1];
      const dx = point.x - lastPoint.x;
      const dy = point.y - lastPoint.y;

      this.viewBoxX.update(x => x - dx);
      this.viewBoxY.update(y => y - dy);
    } else if (this.mode() === 'erase') {
      this.eraseAtPoint(point);
    }
  }

  protected onMouseUp(): void {
    if (this.mode() === 'draw') {
      this.stopDrawing();
    } else if (this.mode() === 'pan') {
      this.isPanning = false;
      this.currentPath = null;
    }
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();

    const svg = this.svgElement().nativeElement;
    const rect = svg.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Get SVG point before zoom
    const svgPoint = this.screenToSVG(event.clientX, event.clientY);

    // Zoom
    const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9;
    const newWidth = this.viewBoxWidth() * zoomFactor;
    const newHeight = this.viewBoxHeight() * zoomFactor;

    // Adjust viewBox to keep zoom centered at mouse
    const mouseRelX = mouseX / rect.width;
    const mouseRelY = mouseY / rect.height;

    const newX = svgPoint.x - mouseRelX * newWidth;
    const newY = svgPoint.y - mouseRelY * newHeight;

    this.viewBoxX.set(newX);
    this.viewBoxY.set(newY);
    this.viewBoxWidth.set(newWidth);
    this.viewBoxHeight.set(newHeight);
  }

  // Touch events
  protected onTouchStart(event: TouchEvent): void {
    event.preventDefault();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const point = this.screenToSVG(touch.clientX, touch.clientY);

      this.touches.set(touch.identifier, {
        id: touch.identifier,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
      });
    }

    if (this.touches.size === 2 && this.mode() !== 'erase') {
      // Start pinch zoom - freeze reference frame
      const touchArray = Array.from(this.touches.values());
      const t1 = touchArray[0];
      const t2 = touchArray[1];

      this.initialPinchDistance = Math.hypot(t2.lastX - t1.lastX, t2.lastY - t1.lastY);
      this.initialZoom = 1;
      this.pinchCenter = {
        x: (t1.lastX + t2.lastX) / 2,
        y: (t1.lastY + t2.lastY) / 2,
      };

      // Freeze viewBox at pinch start
      this.frozenViewBox = {
        x: this.viewBoxX(),
        y: this.viewBoxY(),
        width: this.viewBoxWidth(),
        height: this.viewBoxHeight(),
      };

      // Stop any drawing
      if (this.isDrawing) {
        this.stopDrawing();
      }
    } else if (this.touches.size === 1) {
      const point = this.screenToSVG(event.touches[0].clientX, event.touches[0].clientY);

      if (this.mode() === 'draw') {
        this.startDrawing(point);
      } else if (this.mode() === 'erase') {
        this.eraseAtPoint(point);
      }
    }
  }

  protected onTouchMove(event: TouchEvent): void {
    event.preventDefault();

    // Update touch positions
    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      const touchInfo = this.touches.get(touch.identifier);
      if (touchInfo) {
        const point = this.screenToSVG(touch.clientX, touch.clientY);
        touchInfo.lastX = point.x;
        touchInfo.lastY = point.y;
      }
    }

    if (this.touches.size === 2 && this.frozenViewBox && this.pinchCenter) {
      // Pinch zoom
      const touchArray = Array.from(this.touches.values());
      const t1 = touchArray[0];
      const t2 = touchArray[1];

      const currentDistance = Math.hypot(t2.lastX - t1.lastX, t2.lastY - t1.lastY);
      const scale = this.initialPinchDistance / currentDistance;

      const newWidth = this.frozenViewBox.width * scale;
      const newHeight = this.frozenViewBox.height * scale;

      // Calculate new viewBox position to keep pinch center fixed
      const svg = this.svgElement().nativeElement;
      const rect = svg.getBoundingClientRect();

      // Get the screen position of the pinch center at start
      const centerScreenX = event.touches[0].clientX + (event.touches[1].clientX - event.touches[0].clientX) / 2;
      const centerScreenY = event.touches[0].clientY + (event.touches[1].clientY - event.touches[0].clientY) / 2;

      const mouseRelX = (centerScreenX - rect.left) / rect.width;
      const mouseRelY = (centerScreenY - rect.top) / rect.height;

      const newX = this.pinchCenter.x - mouseRelX * newWidth;
      const newY = this.pinchCenter.y - mouseRelY * newHeight;

      this.viewBoxX.set(newX);
      this.viewBoxY.set(newY);
      this.viewBoxWidth.set(newWidth);
      this.viewBoxHeight.set(newHeight);
    } else if (this.touches.size === 1 && this.mode() === 'draw' && this.isDrawing) {
      const touch = event.touches[0];
      const point = this.screenToSVG(touch.clientX, touch.clientY);
      this.continueDrawing(point);
    } else if (this.touches.size === 1 && this.mode() === 'erase') {
      const touch = event.touches[0];
      const point = this.screenToSVG(touch.clientX, touch.clientY);
      this.eraseAtPoint(point);
    }
  }

  protected onTouchEnd(event: TouchEvent): void {
    event.preventDefault();

    for (let i = 0; i < event.changedTouches.length; i++) {
      const touch = event.changedTouches[i];
      this.touches.delete(touch.identifier);
    }

    if (this.touches.size < 2) {
      this.frozenViewBox = null;
      this.pinchCenter = null;
    }

    if (this.touches.size === 0) {
      if (this.isDrawing) {
        this.stopDrawing();
      }
    }
  }

  // Drawing methods
  private startDrawing(point: Point): void {
    this.isDrawing = true;
    this.currentPath = {
      id: crypto.randomUUID(),
      points: [point],
      color: this.color(),
      strokeWidth: this.strokeWidth(),
    };
  }

  private continueDrawing(point: Point): void {
    if (!this.currentPath) return;
    this.currentPath.points.push(point);

    // Update signal to trigger re-render
    this.paths.update(paths => [...paths]);
  }

  private stopDrawing(): void {
    if (this.currentPath && this.currentPath.points.length > 1) {
      this.paths.update(paths => [...paths, this.currentPath!]);
    }
    this.currentPath = null;
    this.isDrawing = false;
  }

  // Erase methods
  private eraseAtPoint(point: Point): void {
    const eraseTolerance = this.strokeWidth() * 2;

    this.paths.update(paths =>
      paths.filter(path => !this.pathIntersectsPoint(path, point, eraseTolerance))
    );
  }

  private pathIntersectsPoint(path: Path, point: Point, tolerance: number): boolean {
    for (let i = 0; i < path.points.length - 1; i++) {
      const p1 = path.points[i];
      const p2 = path.points[i + 1];

      if (this.distanceToSegment(point, p1, p2) < tolerance) {
        return true;
      }
    }
    return false;
  }

  private distanceToSegment(p: Point, v: Point, w: Point): number {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);

    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));

    const projX = v.x + t * (w.x - v.x);
    const projY = v.y + t * (w.y - v.y);

    return Math.hypot(p.x - projX, p.y - projY);
  }

  // File operations
  protected saveSVG(): void {
    const svg = this.svgElement().nativeElement;
    const clone = svg.cloneNode(true) as SVGSVGElement;

    // Remove toolbar/UI elements if any were in the SVG
    const toolbar = clone.querySelector('.toolbar');
    if (toolbar) toolbar.remove();

    // Create standalone SVG
    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${Date.now()}.svg`;
    a.click();

    URL.revokeObjectURL(url);
  }

  protected openSVG(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg';

    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const svgText = event.target?.result as string;
        this.parseSVG(svgText);
      };
      reader.readAsText(file);
    };

    input.click();
  }

  private parseSVG(svgText: string): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    if (!svg) return;

    const paths: Path[] = [];
    const pathElements = svg.querySelectorAll('path');

    pathElements.forEach(pathEl => {
      const d = pathEl.getAttribute('d');
      if (!d) return;

      const points = this.parsePathData(d);
      const stroke = pathEl.getAttribute('stroke') || '#000000';
      const strokeWidth = parseFloat(pathEl.getAttribute('stroke-width') || '3');

      paths.push({
        id: crypto.randomUUID(),
        points,
        color: stroke,
        strokeWidth,
      });
    });

    this.paths.set(paths);
  }

  private parsePathData(d: string): Point[] {
    const points: Point[] = [];
    const commands = d.match(/[MLZ][^MLZ]*/g);

    if (!commands) return points;

    commands.forEach(cmd => {
      const type = cmd[0];
      const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

      if (type === 'M' || type === 'L') {
        for (let i = 0; i < coords.length; i += 2) {
          points.push({ x: coords[i], y: coords[i + 1] });
        }
      }
    });

    return points;
  }

  // Path rendering helper
  protected getPathData(path: Path): string {
    if (path.points.length === 0) return '';

    let d = `M ${path.points[0].x} ${path.points[0].y}`;
    for (let i = 1; i < path.points.length; i++) {
      d += ` L ${path.points[i].x} ${path.points[i].y}`;
    }
    return d;
  }

  // Mode helpers
  protected setMode(mode: Mode): void {
    this.mode.set(mode);
  }

  protected get allPaths(): Path[] {
    const paths = [...this.paths()];
    if (this.currentPath && this.currentPath.points.length > 0) {
      paths.push(this.currentPath);
    }
    return paths;
  }
}
