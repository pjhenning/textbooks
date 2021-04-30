import {$N, ElementView, observe, SVGParentView, SVGView} from '@mathigon/boost';
import {Angle, Point, Rectangle} from '@mathigon/euclid';
import {Draggable, Slider, Step} from '@mathigon/studio';
import {Solid} from '../../shared/components/webgl/solid';

const DOTS = [
  [],  // 0
  [[0, 0]],  // 1
  [[-0.9, -0.9], [0.9, 0.9]],  // 2
  [[-1, -1], [0, 0], [1, 1]],  // 3
  [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]],  // 4
  [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]],  // 5
  [[-0.9, -1.1], [-0.9, 0], [-0.9, 1.1], [0.9, -1.1], [0.9, 0], [0.9, 1.1]]  // 6
];

function makeFaceContents(i: number): [SVGView, SVGView[]] {
  const size = 100;
  const $rect = $N('rect', {width: `${size}%`, height: `${size}%`, fill: 'white'}) as SVGView;
  const halfSize = size / 2;
  const margin = 0.25;
  const marginSize = size * margin;
  const scale = (size - (marginSize * 2)) / size;
  const $dots = DOTS[i].map(p => {
    const x = (p[0] * halfSize) + halfSize;
    const y = (p[1] * halfSize) + halfSize;
    return $N(
        'circle',
        {
          cx: `${(x * scale) + marginSize}%`,
          cy: `${(y * scale) + marginSize}%`,
          r: `${size / 9}%`,
          fill: 'black'
        }
    ) as SVGView;
  });
  return [$rect, $dots];
}

function makeFaceSVG(i: number) {
  const $contents = makeFaceContents(i);
  const $dieSVG = $N('svg', {viewbox: '0 0 100 100'}) as SVGParentView;
  $dieSVG.append($contents[0]);
  for (const $dot of $contents[1]) $dieSVG.append($dot);
  return $dieSVG;
}

export type NetPosition = {pos: [number, number], opposite: number};

function placementsHave(p: Record<number, number>, v: number) {
  for (const k in p) {
    if (p[k] == v) return true;
  }
  return false;
}

export function setupDieFacesPlacement($step: Step, netPositions: NetPosition[]) {
  const placedCount = observe({c: 0});

  placedCount.watch(val => {
    if (val.c == 6) $step.score('faces-placed');
  });

  const facesPlaced: Record<number, number> = {};
  const sideSize = 100;
  const $svg = $step.$('svg') as SVGParentView;
  const $rootGroup = $N('g', {}, $svg) as SVGView;
  const $targets = netPositions.map((netPosition, index) => {
    const [x, y] = netPosition.pos;
    const $sideGroup = $N('g', {}, $rootGroup) as SVGView;
    const shape = new Rectangle(new Point(0, 0), sideSize, sideSize);
    const $target = $N('path', {}, $sideGroup) as SVGView;
    $target.draw(shape);
    $target.addClass('target');
    $target.setAttr('side-index', index);
    $sideGroup.setAttr('transform', `translate(${x * sideSize} ${y * sideSize})`);
    return $target;
  });
  $rootGroup.setAttr('transform', 'scale(0.8)');
  const $facesArea = $step.$('div.die-faces')!;
  const $faces = $facesArea.$$('div.face') as ElementView[];
  for (const [index, $face] of $faces.entries()) {
    const $die = makeFaceSVG(index + 1);
    $face.append($die);
  }
  const faces = $faces.map($face => new Draggable($face, {$targets, useTransform: true, resetOnMiss: true, withinBounds: false}));
  for (const [index, face] of faces.entries()) {
    face.on('enter-target', ({$target}: {$target: ElementView}) => {
      $target.addClass('over');
    });
    face.on('exit-target', ({$target}: {$target: ElementView}) => {
      $target.removeClass('over');
    });
    const $f = face.$el.$('svg')!.copy(true, false);
    $f.setAttr('width', sideSize);
    $f.setAttr('height', sideSize);
    face.on('end', ({$target}: {$target?: ElementView}) => {
      if ($target == undefined) return;
      $target.removeClass('over');
      const faceValue = index + 1;
      const targetIndex = parseInt($target.attr('side-index'));
      const oppositeIndex = netPositions[targetIndex].opposite;
      if (
        (
          facesPlaced[oppositeIndex] == undefined &&
          !placementsHave(facesPlaced, 7 - faceValue)
        ) ||
        facesPlaced[oppositeIndex] + faceValue == 7
      ) {
        $target.addClass('placed');
        $target.parent?.prepend($f);
        facesPlaced[targetIndex] = faceValue;
        placedCount.c++;
        face.$el.remove();
        $step.addHint('correct');
        for (const f of faces) {
          f.removeTarget($target);
        }
      } else {
        $step.addHint('incorrect');
        face.resetPosition();
      }
    });
  }
}

abstract class WaterShape {
  protected innerRadius: number;
  protected innerHeight: number;
  protected cap: ReturnType<Solid['addSolid']>;
  protected clippingPlane: THREE.Plane;
  protected waterBody: ReturnType<Solid['addSolid']>;

  constructor(containerRadius: number, containerHeight: number, protected center: THREE.Vector3, $solid: Solid) {
    const waterShapeScale = 0.99;
    this.innerHeight = waterShapeScale * containerHeight;
    this.innerRadius = waterShapeScale * containerRadius;

    const shapeGeo = this.geo(containerRadius, containerHeight);

    const capGeo = new THREE.CircleGeometry(this.innerRadius, 32);
    capGeo.rotateX(Angle.fromDegrees(90).rad);

    this.clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0));

    const waterGeo = shapeGeo.clone().scale(waterShapeScale, waterShapeScale, waterShapeScale);

    this.waterBody = $solid.addSolid(waterGeo, 0x0f82f2, {clippingPlanes: [this.clippingPlane]});
    this.waterBody.position.set(center.x, center.y, center.z);

    this.cap = $solid.addSolid(capGeo, 0x0f82f2);

    this.waterLevel = 0;

    const container = $solid.addOutlined(shapeGeo);
    container.position.set(center.x, center.y, center.z);
  }

  get fillStart() {
    const yDepthFromCenter = this.center.y - (this.innerHeight / 2);
    return new THREE.Vector3(this.center.x, yDepthFromCenter, this.center.z);
  }

  abstract geo(radius: number, height: number): THREE.Geometry;

  private set waterLevel(waterLevel: number) {
    const newCapY = this.fillStart.y + waterLevel;
    this.capPosition = new THREE.Vector3(this.center.x, newCapY, this.center.z);
    if (waterLevel < 0.01) {
      this.cap.visible = false;
      this.waterBody.visible = false;
    } else {
      this.cap.visible = true;
      this.waterBody.visible = true;
    }
  }

  private set capPosition(pos: THREE.Vector3) {
    this.cap.position.set(pos.x, pos.y, pos.z);
    this.clippingPlane.setFromNormalAndCoplanarPoint(this.clippingPlane.normal, this.cap.position);
  }

  setFillAmount(percent: number) {
    this.waterLevel = this.waterHeightForFilledPercent(percent);
    const capScale = this.capScaleForFilledPercent(percent);
    this.cap.scale.set(capScale, 1, capScale);
  }

  abstract waterHeightForFilledPercent(filledPercent: number): number;

  protected capScaleForFilledPercent(filledPercent: number) {
    return this.capRadiusForFilledPercent(filledPercent) / this.innerRadius;
  }

  abstract capRadiusForFilledPercent(filledPercent: number): number;
}

export function setupHourglass<A extends WaterShape, B extends WaterShape>(
    a: {
    shape: A,
    drainAmount: number
  },
    bShape: B,
    $solid: Solid,
    $slider: Slider
) {
  $slider.on('move', n => {
    const percent = n / 100;
    a.shape.setFillAmount(1 - (percent * a.drainAmount));
    bShape.setFillAmount(percent);
    $solid.scene.draw();
  });
}

export class WaterCone extends WaterShape {
  geo(radius: number, height: number) {
    return new THREE.ConeGeometry(radius, height, 128, 1);
  }

  waterHeightForFilledPercent(filledPercent: number) {
    const invPercent = 1 - filledPercent;
    return this.innerHeight - (((this.innerHeight ** 3) * invPercent) ** (1 / 3));
  }

  capRadiusForFilledPercent(filledPercent: number) {
    const invPercent = 1 - filledPercent;
    return ((this.innerRadius ** 3) * invPercent) ** (1 / 3);
  }
}

export class WaterCylinder extends WaterShape {
  geo(radius: number, height: number) {
    return new THREE.CylinderGeometry(radius, radius, height, 128, 1);
  }

  waterHeightForFilledPercent(percent: number) {
    const rSq = this.innerRadius ** 2;
    const maxVolume = Math.PI * rSq * this.innerHeight;
    const currentVolume = maxVolume * percent;
    return currentVolume / (Math.PI * rSq);
  }

  capRadiusForFilledPercent(_filledPercent: number) {
    return this.innerRadius;
  }
}


export class WaterSphere extends WaterShape {
  private waterHeight?: number;
  private doublePiR3: number;
  private fourPiR3: number;
  private oneThird = 1/3;
  private sqrt3 = Math.sqrt(3);
  private r2: number;
  private b = (2 * Math.PI) ** this.oneThird;
  private c: number;

  constructor(containerRadius: number, center: THREE.Vector3, $solid: Solid) {
    super(containerRadius, containerRadius * 2, center, $solid);
    this.doublePiR3 = 2 * Math.PI * (this.innerRadius ** 3);
    this.fourPiR3 = 2 * this.doublePiR3;
    this.r2 = this.innerRadius ** 2;
    this.c = this.b * this.r2;
  }

  geo(radius: number, _height: number) {
    return new THREE.SphereGeometry(radius, 32, 32);
  }

  waterHeightForFilledPercent(filledPercent: number) {
    if (this.waterHeight != undefined) {
      const height = this.waterHeight;
      this.waterHeight = undefined;
      return height; 
    } else {
      const a = ((this.sqrt3 * Math.sqrt((3 * (filledPercent ** 2)) - (this.fourPiR3 * filledPercent))) + this.doublePiR3 - (3 * filledPercent)) ** this.oneThird;
      this.waterHeight = (a / this.b) + (this.c / a) + this.innerRadius;
      return this.waterHeight;
    }
  }

  capRadiusForFilledPercent(filledPercent: number) {
    let h_ = 0;
    if (this.waterHeight != undefined) {
      h_ = this.innerRadius - this.waterHeight;
      this.waterHeight = undefined;
    } else {
      h_ = this.innerRadius - this.waterHeightForFilledPercent(filledPercent);
    }
    return Math.sqrt(this.r2 - (h_ ** 2));
  }
}
