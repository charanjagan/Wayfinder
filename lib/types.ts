export interface FloorPlan {
  id: string;
  name: string;
  createdAt: string;
  imageWidth: number;
  imageHeight: number;
}

export interface Graph {
  floorPlan: FloorPlan;
  /** Fixed kiosk/reception point routes are drawn from. Admin-placed, single point. */
  youAreHere: { x: number; y: number } | null;
}

export interface Zone {
  id: string;
  name: string;
  points: [number, number][];
  hidden: boolean;
}

export interface Label {
  id: string;
  text: string;
  type: 'workstation' | 'zone' | 'room' | 'facility';
  x: number;
  y: number;
  associatedZone: string | null;
}
