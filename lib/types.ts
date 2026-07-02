export type Category = 'zone' | 'room' | 'facility';

export interface FloorPlan {
  id: string;
  name: string;
  createdAt: string;
  imageWidth: number;
  imageHeight: number;
}

export interface Waypoint {
  id: string;
  x: number;
  y: number;
}

export interface Edge {
  from: string;
  to: string;
}

export interface POI {
  id: string;
  name: string;
  category: Category;
  x: number;
  y: number;
  nearestWaypoint: string;
  aliases?: string[];
  isEntrance?: boolean;
}

export interface Graph {
  floorPlan: FloorPlan;
  waypoints: Waypoint[];
  edges: Edge[];
  pois: POI[];
}

export interface FloorPlanSummary {
  id: string;
  name: string;
  createdAt: string;
  thumbnail: string;
}
