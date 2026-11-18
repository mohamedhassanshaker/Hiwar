// The only module that reaches into the generated design-system bundle.
// Everything else imports the typed components and the icon lookup from here.
import type { ComponentType, CSSProperties, ReactNode } from "react";

import components from "./generated/ds-components.js";
import { ICON_NAMES, type IconName } from "./icon-names";

export { ICON_NAMES };
export type { IconName };

export type ButtonProps = {
  type?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "xl";
  state?: "default" | "hover" | "pressed" | "focused" | "disabled";
  label?: ReactNode;
  iconL?: boolean;
  iconL2?: ReactNode;
};

export type TagProps = {
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "info";
  size?: "sm" | "md";
  dot?: boolean;
  icon?: ReactNode;
  label?: ReactNode;
  dir?: "ltr" | "rtl";
};

export type BadgeProps = {
  type?: "dot" | "number";
  text1?: string;
};

export type LogoModesProps = {
  property1?: "light" | "dark";
  style?: CSSProperties;
};

export type IconProps = {
  style?: CSSProperties;
};

const typed = <P,>(name: string): ComponentType<P> => components[name] as unknown as ComponentType<P>;

export const Button = typed<ButtonProps>("Button");
export const Tag = typed<TagProps>("Tag");
export const Badge = typed<BadgeProps>("Badge");
export const LogoModes = typed<LogoModesProps>("LogoModes");

/** Resolves an icon by its design-system name, the way the prototype's `Ic` reads `D[name]`. */
export const icon = (name: string): ComponentType<IconProps> | undefined =>
  components[name] as ComponentType<IconProps> | undefined;
