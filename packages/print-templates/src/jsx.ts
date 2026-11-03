// Minimal JSX runtime for badge templates. Satori takes plain element objects,
// so there is no React here: an element is just { type, props }.

import type { CSSProperties, JSX as SatoriJSX } from "satori/jsx";

// Satori's own typings: the CSS properties and HTML elements it supports.
// Types only, so nothing from Satori's JSX runtime is loaded.
export type Style = CSSProperties;

export type Child = Element | string | number | null | undefined | false;
export type Children = Child | Children[];

export type Element = {
  type: string;
  props: { style?: Style; children?: Children; [key: string]: unknown };
};

type ElementProps = {
  style?: Style;
  /** Tailwind classes, understood by Satori. Sizes are dots, not mm. */
  tw?: string;
  children?: Children;
};

type Component<P> = (props: P & { children?: Children }) => Element;

// A fragment is only a marker: the parent splices its children in, so they
// become the parent's own flex items. It never reaches Satori; a fragment at
// the very root is wrapped by rootElement.
const FRAGMENT_TYPE = "scoutin:fragment";

function isFragment(c: unknown): c is Element {
  return (
    typeof c === "object" && c !== null && (c as Element).type === FRAGMENT_TYPE
  );
}

function flatten(children: unknown[], out: Child[] = []): Child[] {
  for (const c of children) {
    if (Array.isArray(c)) flatten(c, out);
    else if (isFragment(c)) flatten([c.props.children], out);
    else if (c !== null && c !== undefined && c !== false && c !== true) {
      out.push(c as Child);
    }
  }
  return out;
}

export function h(
  type: string | Component<never>,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): Element {
  const kids = flatten(children);
  if (typeof type === "function") {
    // Called right away: templates are synchronous trees, no lazy rendering.
    return (type as Component<Record<string, unknown>>)({
      ...props,
      children: (kids.length <= 1 ? kids[0] : kids) as Children,
    });
  }
  const p: Element["props"] = { ...props };
  if (kids.length > 0)
    p.children = (kids.length === 1 ? kids[0] : kids) as Children;
  return { type, props: p };
}

export const Fragment = Symbol.for("scoutin.print.fragment");

/** Automatic runtime entry (jsx, jsxs, jsxDEV). */
export function jsx(
  type: string | Component<never> | typeof Fragment,
  props: Record<string, unknown>,
  key?: unknown,
): Element {
  const { children, ...rest } = props;
  const all = rest as Record<string, unknown>;
  void key; // keys mean nothing without a reconciler
  if (type === Fragment) {
    return { type: FRAGMENT_TYPE, props: { children: children as Children } };
  }
  return h(type as string, all, ...(children === undefined ? [] : [children]));
}

/**
 * The element to hand to Satori for a template's result. Normally the result
 * itself; a fragment at the root has no parent to join, so it becomes a flex
 * wrapper (Satori wants an explicit display on multi-child divs).
 */
export function rootElement(el: Element): Element {
  return isFragment(el)
    ? h("div", { style: { display: "flex" } }, el.props.children)
    : el;
}

export namespace JSX {
  export type Element = import("./jsx.ts").Element;
  export interface ElementChildrenAttribute {
    children: object;
  }
  // Satori's attribute types per element, with our own style, tw and children:
  // an element here is a plain { type, props } object, not a React element.
  export type IntrinsicElements = {
    [K in keyof SatoriJSX.IntrinsicElements]: Omit<
      SatoriJSX.IntrinsicElements[K],
      "children" | "style" | "ref" | "key" | "tw"
    > &
      ElementProps;
  };
}
