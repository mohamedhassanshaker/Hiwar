/**
 * The user guide's scenarios (`docs/02-product-requirements/flows.md`).
 *
 * One entry per thing somebody actually sets out to do, in the words of the screens they
 * will see. The pictures are checked in under `public/guide`; a screen that changes needs its
 * picture replaced by hand.
 */

export type GuideStep = {
  /** The file name under `public/guide/<lang>/`, without its extension. */
  shot: string;
  /** Where the capture goes, and where "Open the screen" sends the reader. */
  path: string;
  en: string;
  ar: string;
};

export type GuideScenario = {
  slug: string;
  role: "Everyone" | "Requester" | "Doer" | "Approver" | "Designer" | "Administrator";
  titleEn: string;
  titleAr: string;
  purposeEn: string;
  purposeAr: string;
  beforeEn: string;
  beforeAr: string;
  steps: GuideStep[];
  resultEn: string;
  resultAr: string;
  troubleEn: string;
  troubleAr: string;
};

export const ROLES: { id: GuideScenario["role"]; en: string; ar: string }[] = [
  { id: "Everyone", en: "Everyone", ar: "الجميع" },
  { id: "Requester", en: "Asking for something", ar: "طلب خدمة" },
  { id: "Doer", en: "Doing the work", ar: "تنفيذ العمل" },
  { id: "Approver", en: "Deciding", ar: "اتخاذ القرار" },
  { id: "Designer", en: "Designing agents and flows", ar: "تصميم الوكلاء والمسارات" },
  { id: "Administrator", en: "Running the platform", ar: "إدارة المنصة" },
];

export const SCENARIOS: GuideScenario[] = [
  {
    slug: "find-your-work",
    role: "Everyone",
    titleEn: "Find what is waiting for you",
    titleAr: "اعرف ما ينتظرك",
    purposeEn: "See the work you own and the decisions only you can make, in one place.",
    purposeAr: "اطّلع على عملك والقرارات التي تخصك وحدك، في مكان واحد.",
    beforeEn: "You have an account and have signed in.",
    beforeAr: "لديك حساب وقد سجّلت الدخول.",
    steps: [
      {
        shot: "dashboard",
        path: "/dashboard",
        en: "**Dashboard** opens on your own counters. Each one is a link: select it to see the records behind it rather than a number on its own.",
        ar: "تفتح **لوحة المعلومات** على مؤشراتك. كل مؤشر رابط: اختره لترى السجلات خلفه بدلاً من رقم وحده.",
      },
      {
        shot: "inbox",
        path: "/inbox",
        en: "**Inbox** holds what is addressed to you: an approval to decide, a question an agent asked, a mention in a room. Deciding here lets the agent's run carry on.",
        ar: "يحوي **صندوق الوارد** ما هو موجّه إليك: اعتماد تقرره، سؤال طرحه وكيل، إشارة في اجتماع. قرارك هنا يُكمل عملية الوكيل.",
      },
      {
        shot: "assistant",
        path: "/dashboard",
        en: "The assistant on the right answers about the screen you are on. It only ever does what you are allowed to do yourself.",
        ar: "يجيب المساعد على اليمين عن الشاشة التي تعمل عليها. ولا يفعل إلا ما تملك صلاحيته بنفسك.",
      },
    ],
    resultEn: "You know what is waiting, and nothing addressed to you is hidden behind a screen you did not open.",
    resultAr: "تعرف ما ينتظرك، ولا يختفي شيء موجّه إليك خلف شاشة لم تفتحها.",
    troubleEn: "A counter you cannot select means you may not see the records behind it. The platform hides what you may not read rather than showing it and refusing.",
    troubleAr: "المؤشر غير القابل للاختيار يعني أنك لا ترى السجلات خلفه. تُخفي المنصة ما لا يحق لك قراءته بدل عرضه ثم رفضه.",
  },
  {
    slug: "raise-a-request",
    role: "Requester",
    titleEn: "Ask for something",
    titleAr: "قدّم طلباً",
    purposeEn: "Raise a request and follow it to its answer.",
    purposeAr: "قدّم طلباً وتابعه حتى الرد.",
    beforeEn: "You may submit requests, and at least one request type is published.",
    beforeAr: "لديك صلاحية تقديم الطلبات، وهناك نوع طلب منشور واحد على الأقل.",
    steps: [
      {
        shot: "requests",
        path: "/requests",
        en: "**Requests** lists what you raised and what you are waiting on. Select **New request**.",
        ar: "تعرض **الطلبات** ما قدّمته وما تنتظره. اختر **طلب جديد**.",
      },
      {
        shot: "new-request",
        path: "/requests",
        en: "Describe what you need in your own words, or fill the form. The assistant proposes a type and fills what it can; you confirm or correct it before anything is submitted.",
        ar: "اشرح ما تحتاجه بكلماتك، أو املأ النموذج. يقترح المساعد النوع ويملأ ما يستطيع؛ وأنت تؤكد أو تصحّح قبل التقديم.",
      },
      {
        shot: "request-detail",
        path: "/requests",
        en: "The request opens on its steps. The marked step is where it is now, and the panel says who has it and what happens next.",
        ar: "يفتح الطلب على خطواته. الخطوة المميزة هي موضعه الآن، وتوضح اللوحة من لديه وما التالي.",
      },
    ],
    resultEn: "The request carries a reference, sits on a step with an owner, and every action on it is recorded.",
    resultAr: "يحمل الطلب رقماً مرجعياً، ويقف على خطوة لها مسؤول، وكل إجراء عليه مسجّل.",
    troubleEn: "If the assistant cannot read what you wrote, it offers the form with your words already in it. Nothing is submitted until you confirm.",
    troubleAr: "إذا تعذّر على المساعد فهم ما كتبت، يعرض النموذج وبه كلماتك. ولا يُقدَّم شيء قبل تأكيدك.",
  },
  {
    slug: "work-an-item",
    role: "Doer",
    titleEn: "Take a work item to review",
    titleAr: "أنجز بند عمل حتى المراجعة",
    purposeEn: "Move work from assigned to reviewed, with an agent helping where it can.",
    purposeAr: "انقل العمل من مُسند إلى مُراجع، بمساعدة وكيل حيث يمكن.",
    beforeEn: "A work item is assigned to you, in a project you belong to.",
    beforeAr: "بند عمل مُسند إليك، في مشروع تنتمي إليه.",
    steps: [
      {
        shot: "work-items",
        path: "/work-items",
        en: "**Work Items** lists what is yours. The filters narrow by status, project and assignee, and what you choose stays when you come back.",
        ar: "تعرض **بنود العمل** ما يخصك. تُضيّق عوامل التصفية حسب الحالة والمشروع والمسؤول، ويبقى اختيارك عند عودتك.",
      },
      {
        shot: "work-item-detail",
        path: "/work-items",
        en: "Open one to see its description, sub items, activity and attachments. **Assign to an agent** hands it to an agent you are allowed to use.",
        ar: "افتح بنداً لترى وصفه وبنوده الفرعية ونشاطه ومرفقاته. يُسلّمه **إسناد إلى وكيل** لوكيل تملك صلاحية استخدامه.",
      },
      {
        shot: "work-item-review",
        path: "/work-items",
        en: "**Submit for review** hands it to a reviewer. The platform refuses a reviewer who is also the author when the project says so.",
        ar: "يُسلّم **إرسال للمراجعة** البند لمراجع. وترفض المنصة أن يكون المراجع هو المؤلف إذا نصّ المشروع على ذلك.",
      },
    ],
    resultEn: "The item is with its reviewer, and its history shows who did what and when.",
    resultAr: "البند لدى مراجعه، ويُظهر سجله من فعل ماذا ومتى.",
    troubleEn: "An item with open sub items cannot be approved without saying so. The reason names the sub items that are still open.",
    troubleAr: "لا يُعتمد بند له بنود فرعية مفتوحة دون الإشارة إلى ذلك. ويذكر السبب البنود المفتوحة.",
  },
  {
    slug: "work-in-a-room",
    role: "Doer",
    titleEn: "Work with agents in a room",
    titleAr: "اعمل مع الوكلاء في اجتماع",
    purposeEn: "Hold one conversation where people and agents work on the same topic.",
    purposeAr: "أدِر محادثة واحدة يعمل فيها الموظفون والوكلاء على الموضوع نفسه.",
    beforeEn: "You are a member of a discussion room.",
    beforeAr: "أنت عضو في اجتماع عمل.",
    steps: [
      {
        shot: "rooms",
        path: "/discussion-rooms",
        en: "**Discussion Rooms** lists the rooms you are in, newest activity first.",
        ar: "تعرض **اجتماعات العمل** الاجتماعات التي تشارك فيها، الأحدث نشاطاً أولاً.",
      },
      {
        shot: "room",
        path: "/discussion-rooms",
        en: "Mention an agent with `@` to bring it in. Its reply carries the version, the model and the estimated cost, so what answered you is never a mystery.",
        ar: "أشر إلى وكيل بـ `@` لإشراكه. ويحمل رده الإصدار والنموذج والتكلفة التقديرية، فلا يبقى مصدر الإجابة مجهولاً.",
      },
    ],
    resultEn: "The room holds the whole thread, and anything the agents produced is attached to the message that produced it.",
    resultAr: "يحتفظ الاجتماع بكامل النقاش، وكل ما أنتجه الوكلاء مرفق بالرسالة التي أنتجته.",
    troubleEn: "A room stops answering when it reaches its hop limit or its cost cap, and says which one stopped it.",
    troubleAr: "يتوقف الاجتماع عن الرد عند بلوغ حد التبادل أو سقف التكلفة، ويوضح أيهما أوقفه.",
  },
  {
    slug: "decide-an-approval",
    role: "Approver",
    titleEn: "Decide an approval",
    titleAr: "اتخذ قرار اعتماد",
    purposeEn: "Let an agent's run carry on, or stop it, with the evidence in front of you.",
    purposeAr: "اسمح لعملية الوكيل بالمتابعة أو أوقفها، والأدلة أمامك.",
    beforeEn: "An approval is addressed to you in your Inbox.",
    beforeAr: "هناك اعتماد موجّه إليك في صندوق الوارد.",
    steps: [
      {
        shot: "approval",
        path: "/inbox",
        en: "The card names the agent, the action it wants to take and the evidence behind it. **Approve** resumes the run; **Reject** ends it with your reason.",
        ar: "تذكر البطاقة الوكيل والإجراء المطلوب والأدلة وراءه. يُكمل **اعتماد** العملية، ويُنهيها **رفض** بسببك.",
      },
    ],
    resultEn: "The run continues or stops, and the decision is recorded against you with its reason.",
    resultAr: "تُكمل العملية أو تتوقف، ويُسجَّل القرار باسمك مع سببه.",
    troubleEn: "An approval that expired says so and escalates rather than waiting for ever.",
    troubleAr: "الاعتماد المنتهي يُظهر ذلك ويُصعَّد بدل الانتظار بلا نهاية.",
  },
  {
    slug: "design-an-agent",
    role: "Designer",
    titleEn: "Design an agent",
    titleAr: "صمّم وكيلاً",
    purposeEn: "Give an agent its instructions, its tools and the limits it works inside.",
    purposeAr: "امنح الوكيل تعليماته وأدواته والحدود التي يعمل داخلها.",
    beforeEn: "You may design agents.",
    beforeAr: "لديك صلاحية تصميم الوكلاء.",
    steps: [
      {
        shot: "agents",
        path: "/agents",
        en: "**Agents** lists every agent with its status, owner and what it last did.",
        ar: "تعرض **الوكلاء** كل وكيل بحالته ومالكه وآخر ما فعل.",
      },
      {
        shot: "agent-detail",
        path: "/agents",
        en: "The detail holds the instructions, the skills, the connectors and the trust level. A change becomes a new version; the one that is running keeps its own.",
        ar: "تحوي التفاصيل التعليمات والمهارات والتكاملات ومستوى الثقة. ويصبح أي تغيير إصداراً جديداً، ويحتفظ الجاري بإصداره.",
      },
    ],
    resultEn: "The agent has a published version, and every run names the version that answered.",
    resultAr: "للوكيل إصدار منشور، وكل عملية تذكر الإصدار الذي أجاب.",
    troubleEn: "A tool an agent may not call is refused at the moment of the call, not only hidden from the list.",
    troubleAr: "تُرفض الأداة غير المسموحة للوكيل لحظة الاستدعاء، لا أن تُخفى من القائمة فقط.",
  },
  {
    slug: "build-a-request-type",
    role: "Designer",
    titleEn: "Build a request type",
    titleAr: "ابنِ نوع طلب",
    purposeEn: "Decide what people may ask for, what you need from them, and who acts at each step.",
    purposeAr: "حدّد ما يمكن طلبه، وما تحتاجه من مقدّمه، ومن يتصرف في كل خطوة.",
    beforeEn: "You may design request types.",
    beforeAr: "لديك صلاحية تصميم أنواع الطلبات.",
    steps: [
      {
        shot: "request-types",
        path: "/request-types",
        en: "Open **Request types** in the menu and open one. Editing works on a draft, so requests already in flight keep the version they started on.",
        ar: "افتح **أنواع الطلبات** من القائمة وافتح نوعاً. يجري التعديل على مسودة، فتبقى الطلبات الجارية على إصدارها.",
      },
      {
        shot: "request-type-steps",
        path: "/request-types",
        en: "Add the steps, say who may act on each, and add the rules that route a request onward. Publishing checks that every step can be reached and that no step is a dead end.",
        ar: "أضف الخطوات، وحدّد من يتصرف في كل منها، وأضف القواعد التي توجّه الطلب. ويتحقق النشر من إمكانية الوصول إلى كل خطوة وألّا تكون أي خطوة طريقاً مسدوداً.",
      },
    ],
    resultEn: "The type is published, and new requests follow it from the moment they are raised.",
    resultAr: "يُنشر النوع، وتتبعه الطلبات الجديدة منذ لحظة تقديمها.",
    troubleEn: "Publishing is blocked with the steps named. Fix what it lists and publish again.",
    troubleAr: "يُمنع النشر مع ذكر الخطوات. صحّح ما يذكره ثم انشر مجدداً.",
  },
  {
    slug: "schedule-recurring-work",
    role: "Designer",
    titleEn: "Schedule work that repeats",
    titleAr: "جدول عملاً متكرراً",
    purposeEn: "Create the same work on a rhythm, without anybody remembering to.",
    purposeAr: "أنشئ العمل نفسه بإيقاع ثابت دون أن يتذكره أحد.",
    beforeEn: "You may create scheduled work in the project.",
    beforeAr: "لديك صلاحية إنشاء عمل مجدول في المشروع.",
    steps: [
      {
        shot: "schedules",
        path: "/scheduled-work-items",
        en: "**Scheduled Work Items** shows each schedule, when it next runs and what its last run produced. **Run now** fires it once and records what it made.",
        ar: "تعرض **بنود العمل المجدولة** كل جدولة وموعدها القادم وما أنتجته آخر مرة. ويُشغّلها **تشغيل الآن** مرة ويسجّل ما أنتجته.",
      },
      {
        shot: "schedule-new",
        path: "/scheduled-work-items",
        en: "A new schedule needs a project, an audience and what to create. Skipping holidays and weekends uses the organisation's own calendar.",
        ar: "تحتاج الجدولة الجديدة إلى مشروع وجمهور وما يُنشأ. ويستخدم تخطي العطل ونهايات الأسبوع تقويم الجهة نفسه.",
      },
    ],
    resultEn: "The schedule runs on its own, and every firing is recorded as Created, Skipped or Failed with its reason.",
    resultAr: "تعمل الجدولة وحدها، ويُسجَّل كل تشغيل كمُنشأ أو متخطّى أو فاشل مع سببه.",
    troubleEn: "A schedule in a paused or archived project is skipped and says which. Resume the project and it fires again.",
    troubleAr: "تُتخطى الجدولة في مشروع متوقف أو مؤرشف مع ذكر السبب. أعِد تشغيل المشروع لتعمل مجدداً.",
  },
  {
    slug: "set-up-knowledge",
    role: "Designer",
    titleEn: "Give agents something to read",
    titleAr: "امنح الوكلاء ما يقرأونه",
    purposeEn: "Put your documents where agents can cite them.",
    purposeAr: "ضع مستنداتك حيث يستطيع الوكلاء الاستشهاد بها.",
    beforeEn: "You may create knowledge collections.",
    beforeAr: "لديك صلاحية إنشاء مجموعات المعرفة.",
    steps: [
      {
        shot: "knowledge",
        path: "/knowledge",
        en: "**Knowledge** lists the collections with how much each holds. Open one to configure it.",
        ar: "تعرض **قاعدة المعرفة** المجموعات وحجم كل منها. افتح واحدة لإعدادها.",
      },
      {
        shot: "knowledge-sources",
        path: "/knowledge",
        en: "Add a source: an upload, a page to crawl, or a path a connector exposes. Indexing starts and the progress on screen is the run's own.",
        ar: "أضف مصدراً: ملفاً مرفوعاً أو صفحة للزحف أو مساراً يتيحه تكامل. تبدأ الفهرسة ويكون التقدم المعروض تقدم التشغيل نفسه.",
      },
      {
        shot: "knowledge-retrieval",
        path: "/knowledge",
        en: "**Test retrieval** asks the collection a question and shows the passages that came back, with their scores.",
        ar: "يسأل **اختبار الاسترجاع** المجموعة سؤالاً ويعرض المقاطع العائدة ودرجاتها.",
      },
    ],
    resultEn: "Agents with access to the collection cite it, and you can see what they would find before they do.",
    resultAr: "يستشهد بها الوكلاء الذين يملكون الوصول، ويمكنك رؤية ما سيجدونه قبل أن يجدوه.",
    troubleEn: "Changing the embedding route re-indexes the whole collection, because half of it in another space would answer differently.",
    troubleAr: "يعيد تغيير مسار التضمين فهرسة المجموعة كاملة، لأن نصفها في فضاء آخر سيجيب بشكل مختلف.",
  },
  {
    slug: "publish-an-assistant",
    role: "Designer",
    titleEn: "Publish an assistant on your website",
    titleAr: "انشر مساعداً على موقعك",
    purposeEn: "Put an agent in front of visitors, following a script you control.",
    purposeAr: "ضع وكيلاً أمام الزوار يتبع سيناريو تتحكم به.",
    beforeEn: "You may configure embedded deployments.",
    beforeAr: "لديك صلاحية إعداد النشر المضمّن.",
    steps: [
      {
        shot: "deployments",
        path: "/embedded-deployment",
        en: "**Embedded Deployment** lists what is published where. Open one to set its agent, the websites it may run on, and how it looks.",
        ar: "تعرض **النشر المضمّن** ما هو منشور وأين. افتح واحداً لضبط وكيله والمواقع المسموح له العمل عليها وشكله.",
      },
      {
        shot: "storyline",
        path: "/embedded-deployment",
        en: "The **Storylines** tab is the script: each step asks, confirms, calls a tool or hands over to a person. **Simulate** plays it before anybody sees it.",
        ar: "تبويب **السيناريوهات** هو النص: كل خطوة تسأل أو تؤكد أو تستدعي أداة أو تحوّل لموظف. ويشغّله **محاكاة** قبل أن يراه أحد.",
      },
      {
        shot: "widget",
        path: "/embedded-deployment",
        en: "**Preview** is the widget a visitor sees, running the published script. **Copy embed code** gives the one line your website needs.",
        ar: "**معاينة** هي الويدجت كما يراها الزائر وهي تشغّل السيناريو المنشور. ويمنحك **نسخ كود التضمين** السطر الذي يحتاجه موقعك.",
      },
    ],
    resultEn: "Visitors on the websites you allowed reach the assistant, and what it creates arrives as ordinary work here.",
    resultAr: "يصل الزوار على المواقع التي سمحت بها إلى المساعد، ويصل ما ينشئه كعمل عادي هنا.",
    troubleEn: "An assistant cannot be enabled with no website allowed, and an accent colour that is hard to read is refused with one that is not.",
    troubleAr: "لا يُفعّل المساعد بلا موقع مسموح، ويُرفض لون التمييز صعب القراءة مع اقتراح بديل واضح.",
  },
  {
    slug: "watch-the-spending",
    role: "Administrator",
    titleEn: "Watch what the agents spend",
    titleAr: "راقب إنفاق الوكلاء",
    purposeEn: "Know what is being spent, and decide what happens when a budget runs out.",
    purposeAr: "اعرف ما يُنفق، وقرّر ما يحدث عند نفاد الميزانية.",
    beforeEn: "You may see budgets.",
    beforeAr: "لديك صلاحية عرض الميزانيات.",
    steps: [
      {
        shot: "budgets",
        path: "/budgets",
        en: "**Budgets** shows each agent's period against its limit. Open one to set the warning threshold and what happens at the limit.",
        ar: "تعرض **الميزانيات** فترة كل وكيل مقابل حده. افتح واحدة لضبط حد التنبيه وما يحدث عند بلوغ الحد.",
      },
    ],
    resultEn: "A budget that is reached notifies, moves to a cheaper route or pauses the agent, as you chose.",
    resultAr: "الميزانية المستنفدة تُنبّه أو تنتقل لمسار أقل كلفة أو توقف الوكيل، حسب اختيارك.",
    troubleEn: "Every figure is an estimate from the tokens a run reported, and it is labelled as one wherever it appears.",
    troubleAr: "كل رقم تقدير مبني على الرموز التي أبلغت بها العملية، ويُوصف كذلك أينما ظهر.",
  },
  {
    slug: "open-the-platform-up",
    role: "Administrator",
    titleEn: "Let another system use the platform",
    titleAr: "اسمح لنظام آخر باستخدام المنصة",
    purposeEn: "Give one system its own key, and bound what it may do with it.",
    purposeAr: "امنح نظاماً واحداً مفتاحه الخاص، وحدّد ما يمكنه فعله به.",
    beforeEn: "You may create integration clients.",
    beforeAr: "لديك صلاحية إنشاء عملاء التكامل.",
    steps: [
      {
        shot: "integrations",
        path: "/integrations",
        en: "**Integrations** lists each client, what it may do and what it has. **New client** asks for an owner and at least one permission.",
        ar: "تعرض **التكاملات** كل عميل وما يمكنه فعله وما يملكه. ويطلب **عميل جديد** مالكاً وإذناً واحداً على الأقل.",
      },
      {
        shot: "integration-keys",
        path: "/integrations",
        en: "A key's secret is shown once. **Rotate** issues a new one and leaves the old working for a grace period; **Revoke** stops it immediately.",
        ar: "يظهر سر المفتاح مرة واحدة. يُصدر **تدوير** مفتاحاً جديداً ويُبقي القديم عاملاً لفترة سماح؛ ويوقفه **إلغاء** فوراً.",
      },
    ],
    resultEn: "The system reaches only the tools and agents you exposed, from the origins you allowed, and every refusal is recorded against it.",
    resultAr: "يصل النظام فقط إلى الأدوات والوكلاء الذين أتحتهم، من المصادر التي سمحت بها، ويُسجَّل كل رفض باسمه.",
    troubleEn: "Deactivating a client stops every key it holds at once, without having to revoke them one by one.",
    troubleAr: "تعطيل العميل يوقف كل مفاتيحه دفعة واحدة دون إلغائها واحداً واحداً.",
  },
];
