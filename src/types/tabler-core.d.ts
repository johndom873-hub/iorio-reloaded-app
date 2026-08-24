declare module "@tabler/core" {
  export class Tooltip {
    constructor(element: Element, options?: { title?: string; placement?: string });
    dispose(): void;
  }
}
