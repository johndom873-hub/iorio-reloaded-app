declare module "@tabler/core/dist/js/tabler.esm.min.js" {
  export class Tooltip {
    constructor(element: Element, options?: { title?: string; placement?: string });
    dispose(): void;
  }

  export class Collapse {
    static getOrCreateInstance(element: Element, config?: { toggle?: boolean }): Collapse;
    hide(): void;
    show(): void;
  }
}
