# Tahseel Design System

Tahseel is a digital government revenue and payments ecosystem in the UAE. It provides digital payment, collection and related services through web portals, mobile apps and supporting platforms.

## Sources
- Figma file "♦️Tahseel - Web & Mob App.fig" (attached as a mounted file). Pages: Get-Started, Design-System-Documentation, Final-Login-Flow-Dev, Final-Services-Payment-Dev, CS-Dashboard-Dev, Company-Dashboard-Dev, News-and-Events, About-Tahseel, Services, empty-states, QA-Frontend-Review.
- Token exports: `uploads/2. Semantic/`, `uploads/3. Component/`, `uploads/Typography/`.

## Products
- **Web portal**: login (individual / company / company responsible account), services and payment flows, the customer dashboard (pay bills, transactions, my requests, Tahseel card) and the company dashboard (trucks, card requests, balance transfer and refund).
- **Mobile app**: login with PIN and Face ID, quick actions, NFC scanning of Emirates ID and the Tahseel card, and payment.
- **Bilingual**: every screen exists in both English and Arabic (RTL).

## Content fundamentals
- **Tone**: formal and service-oriented, as fits a government product.
- **Address**: the user is addressed as "you".
- **Casing**: Title Case on screen titles ("Pay Bills", "Request New Tahseel Card"); sentence case in helper text.
- **Emoji**: none.
- **Language pairing**: Arabic and English versions sit side by side as Ar/En pairs.

## Visual foundations
- **Brand blue**: #0677FF (rgb 6,119,255), with a deep blue of #0848CE and a midnight of #12034B.
- **Text**: slate #323C50; secondary text #656D7C; muted #989DA7.
- **Surfaces**: #F8FAFC and #F2F7FF on white cards, with borders in #E7EDFB.
- **Shadows**: very soft, for example rgba(50,60,80,0.04).
- **Semantic colours**: success green #2F784A, danger #FF6565, purple #6538B5.
- **Type**: AvenirArabic-SharjahGovt in Regular, Medium and Heavy, at 10–32px (mostly 12, 14 and 16). Frutiger LT Arabic is a secondary face.
- **Corners and layout**: rounded radius tokens (`--radi-*`) and generous spacing.
- **Backgrounds**: animated backgrounds on login (light and dark); otherwise clean, flat white and very light blue.
- **Themes**: Light and Dark via `:root[data-theme="dark"]`.

## Iconography
- **Primary icon set (Tahseel Icons):** 510 line icons in `components/icons/` (`icon-data.js` + `Icon`). Use `<Icon name="AlertCircle" size={24} />`; strokes use currentColor. See the "Icon set" card for every name.
- `ScanStatusIcon` (was `Icon`) is the 108px ok/scan status badge.
- Hugeicons-style line icons are copied in as components (ArrowLeft01Round, Cancel01, CreditCard and others), plus an "icon$" glyph set. They are drawn in currentColor.
- Payment logos come from the file: Apple Pay, Google Pay, Samsung Pay, Mastercard and Jaywan.
- The logo is provided by the `LogoModes` component (light/dark).


## Index
- `styles.css`: the global entry point. It imports `tokens/fonts.css`, `components/fig-tokens.css` (all 10 Figma variable collections and their modes, including Light/Dark), `components/fig-assets.css` and `tokens/fig-typography.css`.
- `fonts/`: AvenirArabic-SharjahGovt in Regular, Medium and Heavy.
- `assets/`: `entities/` (partner entity logos), `imagery/` (Emirates ID, vehicle plate, QR code, service map, noise texture) and `payments/` (Amex, Apple card).
- `guidelines/`: foundation cards for Colors, Type, Spacing and Brand.
- `components/`: every component as a .jsx with a matching .d.ts. `components/cards/` holds the Components and Brand cards.
- `ui_kits/tahseel-app/`: a click-through of the app (sign in, pay bills, services, my account, company dashboard, scan & wallet).
- `thumbnail.html` and `SKILL.md`.

## Logo
The Tahseel lockup is the `LogoModes` component (`property1="light" | "dark"`). It is a vector in currentColor, taken from the Figma file. Use it everywhere; never retype the wordmark.

## Colour tokens (tokens/colors.css) — v2 accessibility pass
- **v2 (2026-10-07):** every audited pairing passes WCAG 2.2 AA in Light, Dark, Theme B and Theme B × Dark. See the cards "Color v2 — Contrast audit", "Color v2 — Changelog" and "Dark Mode System". v1 is archived at `tokens/_archive/colors-v1.css`.
- **Canonical naming:** `--{category}-{role}[-{variant}][-{state}]` (surface, text, icon, border, action, feedback, focus, elevation, chart, badge). `--base-*`, `--state-*`, `--text-dark-*`, `--text-text-*`, `--feedback-*-fg` and `--*-error-*` are deprecated aliases. Use "danger", never "error".
- **Info is brand blue** (`--feedback-info-{bg,border,text,icon}`). Neutral/Cancel buttons use `--action-neutral-*`. Never use `--surface-disabled` for an enabled control.
- **Shadows** are navy only (`--elevation-shadow-*`). In Dark, elevation comes from lighter surfaces (page → card → raised → modal).
- **Focus:** a 2px `--focus-ring` with a 2px offset.
- **Status** always pairs colour with an icon or label. KPIs are coloured by meaning, not by sign.

These are extracted from `uploads/tahseel-design-tokens.json`, the CustomerPortalAppV2 export of the Figma collections 1. Primitives and 2. Semantic, exported 2026-10-07.
- **Primitives (142)** are `--color-*` raw values: brand blue/sky/purple/navy, danger/success/warning/info ramps, neutral gray/midnight/slate/blue-gray, alpha dark (rgba of #323C50) and alpha light (rgba of #F8FAFC), plus chart and chart-dark colours.
- **Semantic (83 × 2 modes)** covers the `--surface-*`, `--text-*`, `--icon-*`, `--action-{primary|secondary|danger|tertiary}-*`, `--border-*`, `--feedback-{danger|info|success|warning}-{bg|border|fg}`, `--focus-ring`, `--input-border-focus`, `--elevation-shadow-*` and `--chart-*` families. Each one aliases a primitive through `var()`. Light values sit on `:root`; dark values sit on `:root[data-theme="dark"]`.
- **Rule:** components bind semantic tokens only; never use a raw hex in a UI role. Imagery, partner logos, card art and device chrome are exempt.
- **Load order:** `colors.css` loads after `components/fig-tokens.css`, so it wins wherever names overlap.

## QA pass (2026-10-08)
Components bind `--spacing-*`, `--radi-*`, `--font` / `--font-family-primary` and semantic colour tokens. No raw sizes are used where a token exists. Directional icons mirror under `dir="rtl"` (`tokens/rtl.css`). Full report: the "QA pass — 2026-10-08" card.

## Tokens
- `components/fig-tokens.css`: all Figma variable collections and modes.
- `components/fig-assets.css`: bitmap asset classes.
- `tokens/fig-typography.css`: empty, because the file has no published text styles.

## Fonts
- **AvenirArabic-SharjahGovt** (Regular 400 / Medium 500 / Heavy 900) is the primary UI face, self-hosted in `fonts/`.
- **Frutiger LT Arabic** (45 Light 300 / 55 Roman 400 / 65 Bold 700 / 75 Black 900, Arabic only) is the secondary face, self-hosted. Arabic glyphs come from the FrutigerLTArabic TTFs and Latin glyphs from FrutigerLTStd, joined into one family with unicode-range. `Frutiger LT Std` is also available on its own.
- **Inter, Bai Jamjuree and Space Grotesk** load from Google Fonts. They are only referenced by alternate theme modes.
- **SF Pro Display** (Regular, Medium, Bold + italics 100–900) is self-hosted in `fonts/` and is used only by the iOS theme mode. `SF Pro` and `SF Pro Text` alias the same files.
- All @font-face rules are in `tokens/fonts.css`.

## Naming notes
- Inner layers: the inner layers of Item 1–8 and Component 23 are bundled inside their parent components.
- Duplicate copies: "Dashboard — Request New Tahseel Card (Step 3)" appears twice in the Figma file. The second copy is covered by DashboardRequestNewTahseelCardStep3.

## Component provenance (confirmed intentional)
- **Primary source:** the components were materialized from "♦️Tahseel - Web & Mob App.fig". They keep that file's Figma layer names (PascalCased, with a numeric suffix when names repeat), so `Accordion`, `AccountBalances`, `DashboardCompany`… are the kit's own names, not inventions.
- **Secondary file:** "Figma oguaA67OelfwRK82c8XVEs.fig" (Login Flow — Responsive Company EN, 40 families) was attached later as a reference. Every family in it (Keypad, Key, Keys, Keyboard, Home Indicator, pin code buttons, Face ID, InputOTP, Button, Checkbox, Radio, …) shares node ids with the primary file and is already built. Checks run against that smaller file report the primary file's components as "unmatched"; they are intentional.
- **Intentional additions:**
  - `Icon`: wrapper for the icon-data glyph set.
  - `ApplePayChannel`, `GooglePayChannel`, `QRCodeChannel`: wrap the user-supplied payment-channel logos that had no standalone component in Figma.

## Components (372)
**Naming is intentional.** Every component name comes from its Figma component set in "♦️Tahseel - Web & Mob App". These are deliberate additions, kept 1:1 with the Figma source so designers and developers share one vocabulary. Don't rename them to generic kit names; consumers import them by these names.

All components live flat in `components/` and are exposed as `window.DesignSystem_dbb4cf.<Name>`. Numbered suffixes (`Button2`, `CreditCard3`…) are separate Figma component sets that share a name. An audit on 2026-10-08 compared all 49 numbered variants with their base names and found none identical (the closest share 63–82% of their content). All of them are kept. Candidates for merging into variants in Figma: `Button`/`Button4`, `CompanyButton`/`CompanyButton2`, `CompanyResponsibleAccountButton`/`…2`, `User`/`User3`, `MyRequests`/`MyRequests2`. The Design System tab shows each group as a card.

| Group | Count | Components |
|---|---|---|
| **Buttons & actions** | 17 | Button, Button2, Button4, Button6, ButtonHooverEffect, ButtonIcon, CancelButton, CancelButton2, CompanyButton, CompanyButton2, CompanyResponsibleAccountButton, CompanyResponsibleAccountButton2, KeepPaymentButton, PersonalButton2, PinCodeButtons, PinnButton, SupportLink |
| **Forms & inputs** | 35 | AutoSuggestion, Calendar2, CalendarSlot, Checkbox, Checkbox2, CheckboxGroupCol, CheckboxLabel, DateCalendar, DatePicker, DropdownList, Handler, IconBackspaceFilled, Input, InputCaption, InputMaterial, InputOTP, InputTextArea, Key, Keyboard, Keypad, Keys, ListItem, OTPSlot, QwertyPortraitLayout, Radio, RadioLabel, ReturnKey, SearchBar, Select, Switch, ToggleKnob, ToggleLabel, UploadArea, UploadFile, Uplpoder |
| **Feedback & status** | 21 | Badge, Badge2, CancelPaymentModalPhone, Chip, CountDown, CountDownRedirect, Dot, Dot2, Loader, ModalFeedbackPhone, Notification, ProgressBar, ProgressBar2, ScrollBar, Status, StatusBar, StatusBarTime, StatusPill, Tag, TahseelLoader, Unavailable |
| **Navigation & layout** | 37 | Accordion, AccordionGroup, AnimatedBackgroundForChooseAccount, AnimatedBackgroundLight, CanvasFlowHeader, Container, ControlStrip, FAQ, FilterTab, Frame, Frame1000011737, Frame1000012801, HomeIndicator, InnerPagesDark, InnerPagesLight, InnerPagesLight1, Layout2Column, Layout3Row, ListOrGrid, MenuCatAr, MenuCatEng, MenuDesktop, MenuMobile, PageHeader, PageItem, Pagination, PaginationItems, Tab2, Tab3, TabItemLine, TabItemToggle, TableCell, TableHeader, TabsLine, TabsToggle, Text, Title |
| **Avatars & people** | 12 | Avatar, AvatarByewind, AvatarFemale06, AvatarMale01, AvatarMale03, ByeWind, DrewCano, Entities, Individual, NataliCraig, OrlandoDiggs, UsersThree |
| **Payments & cards** | 50 | ApplePay, BankCards, Card, Cheque, ChequeScan, CrdPaymentArabic, CrdPaymentDeault, CreditCard, DebitCard, DirectDebit, DirectDebit2, EmiratesID, FinalCard, GooglePay, International, Item1, Item2, Item3, Item4, Item5, Item5Base, Item6, Item7, Item8, ItemList, JaywanLogo1, LogoModes, OnlineReceipt, PHYSICALTahseelCard6, POSMPOS, Passport, Payflix, PaymentCard, PaymentCard2, PaymentLink, PaymentMethodsLightMastercard, PaymentsLogos, QrCode, SamsungPay, SamsungPay2, ServiceCard, TahseelCard, TahseelCard2, TahseelPay, TahseelPay2, TahseelWallet, TechApplePayXCard, TechApplePayXPayment, Voucher, Wallet |
| **Mobile flows (login, scan, sheets)** | 34 | App, ChooseAccountTypeEnglish, CompanyCards, Component1, Component23, Component29, ComponentAR, ComponentEN, FaceID, FailureToScanCardEn, ForgotCredentialsPassword, ForgotCredentialsPasswordCompany, ForgotCredentialsUsername, IOSFaceIDAnimation, IOSFaceIDPrompt, LoginNewDesignDesktop, NFCSCANEIDcard, NFCSCANTahseelCard, NewLoginDesignMobile, NewLoginDesignMobile2, NewLoginDesignMobileSecond, NewLoginDesignMobileSecond2, OTPVerificationEmail, OTPVerificationPhoneError, PINCodeLoginOptions, QUICKACTIONS, RateUsICONS, ScanCard, ScanEID, ScanPassport, ScanTahseelCard, ServiceCounter, ServiceLocations, SignIn |
| **Payment channels** | 3 | ApplePayChannel, GooglePayChannel, QRCodeChannel |
| **Payment pages** | 21 | PaymentChannelStep1, PaymentPage5, PaymentPageBankAcc1, PaymentPageDebitCard, PaymentPageDepitCreditCard, PaymentPageOnlineReceipt1, PaymentPagePassport1, PaymentPagePayFlex, PaymentPagePaymentLink1, PaymentPageQRCode1, PaymentPageTahseelPayLogin, PaymentPageUAEID1, PaymentSuccessfulDetails, PersonalDetails, ReviewPayment, ReviewPayment2, ServiceSummary, Services1, ServicesByEntity, ServicesDetails, TransactionDetailsPhone |
| **Customer dashboard** | 30 | AccountInformation, ActivateCard, ActivateTahseelCard, AddTruck, CardActivation, ChangePassword, DashboardHome, DeliveryAddress, DeviceToken, DisableCard, MyAccountMyRequests, MyAccountTopUp, MyAccountTransactions, MyRequests, MyRequests2, MyRequestsRefundRequest, MyRequestsTahseelCard, PayBills, PayBills1PayBills, PayBillsActiveState, PayBillsStep1, PayBillsStep2, PayBillsSummary, PersonalInformation, PinCodeDeactivateCard, RefundRequest, RequestForNewTahseelCard, ResetPinCode, Transactions, TrucksInformation |
| **Company dashboard** | 21 | AccountBalances, AccountBalancesAr, AccountBalancesAr2, CompanyDashboardServiceSummary, DashboardAddTruck, DashboardBalanceRefundExistingAccount, DashboardBalanceRefundNewAccount, DashboardBalanceTransfer, DashboardBalanceTransfer2, DashboardCardDetails, DashboardCardDetails2, DashboardCardDetails3, DashboardCardDetails4, DashboardCompany, DashboardCompany2, DashboardCompany3, DashboardRequestNewTahseelCard, DashboardRequestNewTahseelCardStep2, DashboardRequestNewTahseelCardStep3, DashboardRequestReplacementCard, DashboardRequestReplacementCard2 |
| **Icons** | 96 | ScanStatusIcon, AddCircle, Alert02, ArrowDown, ArrowDown01Sharp, ArrowDown01Sharp2, ArrowDown01Sharp3, ArrowLeft01Round, ArrowLeft02Sharp, ArrowRight01Round, ArrowRight02Round, ArrowRight02Round2, ArrowSquareRight, ArrowUpRight01Sharp, Bank, Calendar, Calendar03, Call, Calling, Cancel01, Chat, CheckCircleFill, ChevronDown, ChevronTight, ComputerDesk01, Copy01, CreditCard3, CreditCard4, CreditCard5, CreditCardChange, CreditCardDefrost, CreditCardFreeze, DefaultIcon, Displeased, Download04, Eye, EyeOutline, EyeOutline2, File01, Folder2, Hide, IONIconAArrowForward, Icon, Icon2, Icon4, IconDictation, IconEmoji, IconsArrowDownSLine, InLove, InfoSign, InformationDiamond, InformationDiamond2, InformationDiamond4, Invoice01, Lock, Login02, Mail01, Menu, Menu01, Menu09, MinusCirlce, Mobile, Moon, Moon2, Neutral, Notebook, Notification01, NotificationBing, NotificationIcon, NotificationSquare, PDF, Payment, PencilEdit01, PlusSignSquare, PlusSignSquare2, Profile02, Relieved01, Sad01, Search, Search3, SecurityPassword, Setting01, Smile, Sorting02, SquareLock02, SquarePassword, Sun01, TickCircle, Ticket03, TouchInteraction02, User, User3, UsersFill, WarningSign, WaterEnergy, X |
