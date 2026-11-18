// The design system readme lists 96 components under "Icons". 95 of them are shipped:
// "Icon" (the icon-data wrapper) is in the readme table but not in _ds_manifest.json
// or _ds_bundle.js, and the console never asks for it.
export const ICON_NAMES = [
  "ScanStatusIcon", "AddCircle", "Alert02", "ArrowDown", "ArrowDown01Sharp", "ArrowDown01Sharp2",
  "ArrowDown01Sharp3", "ArrowLeft01Round", "ArrowLeft02Sharp", "ArrowRight01Round",
  "ArrowRight02Round", "ArrowRight02Round2", "ArrowSquareRight", "ArrowUpRight01Sharp", "Bank",
  "Calendar", "Calendar03", "Call", "Calling", "Cancel01", "Chat", "CheckCircleFill",
  "ChevronDown", "ChevronTight", "ComputerDesk01", "Copy01", "CreditCard3", "CreditCard4",
  "CreditCard5", "CreditCardChange", "CreditCardDefrost", "CreditCardFreeze", "DefaultIcon",
  "Displeased", "Download04", "Eye", "EyeOutline", "EyeOutline2", "File01", "Folder2", "Hide",
  "IONIconAArrowForward", "Icon2", "Icon4", "IconDictation", "IconEmoji", "IconsArrowDownSLine",
  "InLove", "InfoSign", "InformationDiamond", "InformationDiamond2", "InformationDiamond4",
  "Invoice01", "Lock", "Login02", "Mail01", "Menu", "Menu01", "Menu09", "MinusCirlce", "Mobile",
  "Moon", "Moon2", "Neutral", "Notebook", "Notification01", "NotificationBing",
  "NotificationIcon", "NotificationSquare", "PDF", "Payment", "PencilEdit01", "PlusSignSquare",
  "PlusSignSquare2", "Profile02", "Relieved01", "Sad01", "Search", "Search3", "SecurityPassword",
  "Setting01", "Smile", "Sorting02", "SquareLock02", "SquarePassword", "Sun01", "TickCircle",
  "Ticket03", "TouchInteraction02", "User", "User3", "UsersFill", "WarningSign", "WaterEnergy",
  "X",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
