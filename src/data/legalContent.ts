export interface LegalSection {
  id: string;
  number: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDocumentData {
  eyebrow: string;
  title: string;
  subtitle: string;
  effectiveDateLabel: string;
  effectiveDateValue: string;
  scopeLabel: string;
  scopeValue: string;
  summaryPoints: Array<{ label: string; value: string }>;
  sections: LegalSection[];
}

export interface BilingualLegalDocuments {
  privacy: Record<'ar' | 'en', LegalDocumentData>;
  terms: Record<'ar' | 'en', LegalDocumentData>;
}

export const LEGAL_DOCUMENTS: BilingualLegalDocuments = {
  privacy: {
    ar: {
      eyebrow: 'الوثيقة الرسمية للخصوصية وحماية البيانات',
      title: 'سياسة الخصوصية',
      subtitle:
        'توضح هذه السياسة بدقة أنواع البيانات التي يعالجها نظام «الإقفال | AL EQFAL»، وأغراض استخدامها، وآليات التخزين في Firebase وGoogle Drive، وصلاحيات الوصول المعتمدة داخل الكود الفعلي للنظام.',
      effectiveDateLabel: 'آخر تحديث',
      effectiveDateValue: '14 نوفمبر 2026',
      scopeLabel: 'النطاق',
      scopeValue: 'تطبيق الويب الإقفال | AL EQFAL',
      summaryPoints: [
        {
          label: 'نطاق Google Drive',
          value: 'drive.file (المجلدات والملفات المنشأة عبر التطبيق فقط)',
        },
        {
          label: 'حفظ رمز الوصول (Access Token)',
          value: 'في ذاكرة المتصفح المؤقتة (RAM) فقط — لا يُخزّن في قاعدة البيانات',
        },
        {
          label: 'عزل المؤسسات',
          value: 'عزل منطقي صارم حسب معرّف المؤسسة (orgId) في Firestore Rules',
        },
      ],
      sections: [
        {
          id: 'overview',
          number: '01',
          title: 'نظرة عامة ونطاق التطبيق',
          paragraphs: [
            '«الإقفال | AL EQFAL» منظومة سحابية متعددة المؤسسات (Multi-Tenant) لإدارة الورديات اليومية وإقفال الصناديق ومبيعات النقد والشبكة والمصروفات للمؤسسات التجارية والمتاجر والمطاعم والكافيهات.',
            'تسري هذه السياسة على جميع الزوار وأصحاب المؤسسات والمدراء والموظفين الذين يستخدمون واجهة الويب الخاصة بالنظام.',
          ],
        },
        {
          id: 'data-collected',
          number: '02',
          title: 'البيانات التي يجمعها النظام ويعالجها',
          paragraphs: [
            'يجمع النظام ويعالج فقط البيانات اللازمة لتشغيل دورة إقفال الورديات وتنظيم الصلاحيات لكل مؤسسة على حدة:',
          ],
          bullets: [
            'بيانات حساب المدير ومالك المؤسسة (عبر تسجيل الدخول بـ Google في Firebase Authentication): المعرّف الفريد (UID)، معرّف مزود Google (sub)، الاسم الظاهر، البريد الإلكتروني، وحالة توثيق البريد.',
            'بيانات حسابات الموظفين (ينشئها مدير المؤسسة بالبريد الإلكتروني وكلمة المرور): الاسم الظاهر، البريد الإلكتروني، رقم الهاتف (اختياري)، الفرع المخصص، الدور الوظيفي، الصلاحيات، وحالة تفعيل الحساب.',
            'بيانات المؤسسة والفروع: اسم المؤسسة، النشاط التجاري، العملة الأساسية، رقم السجل التجاري (اختياري)، وأسماء الفروع ورموزها وعناوينها وأرقام هواتفها (اختياري).',
            'بيانات إقفالات الورديات: تاريخ الوردية، الفترة (صباحية/مسائية)، مبالغ مبيعات النقد والشبكة والمصروفات، المجاميع المحسوبة، الملاحظات الاختيارية، حالة الإقفال، هوية الموظف المرسل والمدير المراجِع، وأسباب الرفض أو التصحيح الإداري والقيم السابقة عند التصحيح.',
            'سجلات التدقيق وفهرس الأرشفة: سجل غير قابل للتعديل للعمليات الإدارية والتشغيلية (auditLogs)، وفهرس حالة أرشفة ملفات Excel في Google Drive (معرّف الملف، اسمه، رابطه، البصمة الرقمية SHA-256، ورقم الإصدار).',
            'تفضيلات الواجهة المحلية في المتصفح: تُحفظ تفضيلات اللغة (aleqfal_lang) ومظهر العرض الداكن/الفاتح (aleqfal_theme) في localStorage بالمتصفح، إضافةً إلى حالة جلسة Firebase Authentication القياسية.',
            'بيانات نموذج التواصل في الصفحة الرئيسية (#contact): يعرض النموذج حقول الاسم والبريد واسم المؤسسة والرسالة محلياً لتأكيد الاستلام في الواجهة، ولا يرسلها في الإصدار الحالي إلى خادم بريد أو قاعدة بيانات.',
          ],
        },
        {
          id: 'purposes',
          number: '03',
          title: 'أغراض استخدام البيانات',
          paragraphs: [
            'تُستخدم البيانات المذكورة أعلاه حصراً للأغراض التشغيلية والأمنية التالية، ولا يبيع النظام بيانات المستخدمين أو يشاركها مع أي جهة إعلانية أو تسويقية:',
          ],
          bullets: [
            'مصادقة المستخدمين والتحقق من هوية مالك المؤسسة والمدير والموظفين وتطبيق صلاحيات كل دور.',
            'احتساب مبيعات الوردية وصافي الفترة والمتبقي في الصندوق بدقة عشرية ومنع تكرار الإقفال للفرع والفترة والتاريخ نفسه.',
            'تمكين المدير من مراجعة الإقفالات واعتمادها أو إعادتها للتعديل، وتوثيق أي تصحيح إداري لاحق.',
            'توليد تقارير Excel (.xlsx) وملفات CSV للتقارير المالية، وأرشفة ملفات Excel الخاصة بالإقفالات المعتمدة في Google Drive الخاص بمالك المؤسسة والتحقق من مطابقتها عبر البصمة الرقمية SHA-256.',
          ],
        },
        {
          id: 'firebase-storage',
          number: '04',
          title: 'التخزين في Firebase وعزل المؤسسات',
          paragraphs: [
            'تُخزّن بيانات المؤسسات والمستخدمين والفروع والإقفالات وسجلات التدقيق وفهرس الأرشفة في خدمة Google Cloud Firestore المرتبطة بالمشروع.',
            'تُفرض قواعد أمان Firestore Security Rules عزلاً منطقياً صارماً عبر معرّف المؤسسة (orgId)، بحيث يُمنع أي مستخدم من قراءة أو تعديل بيانات مؤسسة أخرى، وتُحظر العمليات فوراً على حسابات الموظفين المعطلة (isActive = false)، كما تُمنع التعديلات المباشرة غير الموثقة على الإقفالات المعتمدة أو سجلات التدقيق.',
          ],
        },
        {
          id: 'google-drive-oauth',
          number: '05',
          title: 'ربط Google Drive وبيانات تفويض OAuth',
          paragraphs: [
            'يتم ربط Google Drive اختيارياً على مستوى كل مؤسسة بواسطة مالك المؤسسة المعتمد حصراً (ownerId)، ولا يُسمح للموظفين أو غير المالكين بتفويض هذا الربط. ومع ذلك، يشترط النظام جاهزية ربط Google Drive والتحقق من الكتابة والقراءة لإتاحة تسجيل إقفالات جديدة.',
          ],
          bullets: [
            'النطاقات المطلوبة (Scopes): يطلب النظام عبر Google Identity Services الحد الأدنى فقط: openid وemail وhttps://www.googleapis.com/auth/drive.file.',
            'حصر الوصول عبر drive.file: لا يمنح هذا النطاق التطبيق صلاحية قراءة أو تعديل أو حذف ملفاتك الأخرى في Google Drive؛ بل يقتصر فقط على المجلدات والملفات التي ينشئها التطبيق نفسه (مجلد المؤسسة، مجلدات الفروع والأشهر، وملفات .xlsx الخاصة بالإقفالات المعتمدة).',
            'تخزين رمز الوصول المؤقت (Access Token): يُحتفظ برمز الوصول في ذاكرة المتصفح المؤقتة (RAM) فقط ومربوطاً بمعرّف المؤسسة النشطة (orgId). لا يُخزّن رمز الوصول في Firestore أو localStorage أو sessionStorage، ويُمسح تلقائياً عند تسجيل الخروج أو تبديل الحساب أو تبديل المؤسسة أو انتهاء مدته.',
            'البيانات المحفوظة عن الربط في Firestore: يحفظ النظام فقط البريد الإلكتروني لحساب Drive المرتبط، الاسم، معرّف Google (sub)، ومعرّفات وروابط المجلدات المنشأة وحالة فحص الكتابة والقراءة.',
          ],
        },
        {
          id: 'retention-export-control',
          number: '06',
          title: 'الاحتفاظ بالبيانات، التصدير، وفصل الربط',
          paragraphs: [
            'نظراً للطبيعة المحاسبية والرقابية للنظام، توضح قواعد التشغيل الفعلية ما يلي:',
          ],
          bullets: [
            'عدم الحذف المباشر للسجلات المحاسبية: تمنع قواعد الأمان الحالية (Firestore Security Rules) حذف وثائق المؤسسات والمستخدمين والفروع والإقفالات المعتمدة وسجلات التدقيق وفهرس الأرشفة من واجهة العميل، حفاظاً على سلامة السجل الرقابي والمالي.',
            'تعطيل الحسابات والفروع: يستطيع مدير المؤسسة تعطيل حساب أي موظف أو تعطيل فرع لمنع الوصول أو التسجيل المستقبلي دون مسح السجلات التاريخية.',
            'فصل ربط Google Drive: يستطيع مالك المؤسسة فصل ربط Google Drive من شاشة الإعدادات في أي وقت؛ ويؤدي ذلك إلى مسح رمز الجلسة من ذاكرة المتصفح وإزالة بيانات الربط من سجل المؤسسة، مع بقاء المجلدات وملفات Excel الموجودة في Google Drive الخاص بالمالك سليمة دون حذف أو تعديل.',
            'تصدير البيانات: يتيح النظام للمدير تصدير تقارير الإقفالات محلياً بصيغتي CSV وExcel (.xlsx)، وتنزيل ملفات Excel المؤرشفة من Google Drive المرتبط.',
          ],
        },
        {
          id: 'inquiries',
          number: '07',
          title: 'التواصل والاستفسار عن البيانات',
          paragraphs: [
            'يمكن لموظفي أي مؤسسة توجيه استفساراتهم المتعلقة ببياناتهم الوظيفية وحساباتهم إلى مدير أو مالك المؤسسة المعني مباشرة.',
            'كما يمكن للزوار وأصحاب المؤسسات إرسال استفساراتهم الفنية أو استفسارات الخصوصية عبر قسم «تواصل معنا» في الصفحة الرئيسية للنظام.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Official Privacy & Data Protection Notice',
      title: 'Privacy Policy',
      subtitle:
        'This Privacy Policy accurately explains what data AL EQFAL processes, why it is collected, how it is stored in Firebase and an organization owner’s Google Drive, and the exact access controls enforced in the live application.',
      effectiveDateLabel: 'Last Updated',
      effectiveDateValue: 'November 14, 2026',
      scopeLabel: 'Scope',
      scopeValue: 'AL EQFAL Web Application',
      summaryPoints: [
        {
          label: 'Google Drive Scope',
          value: 'drive.file only (app-created folders and Excel closing files)',
        },
        {
          label: 'OAuth Token Storage',
          value: 'Browser RAM only, scoped per organization — never persisted to Firestore or Web Storage',
        },
        {
          label: 'Tenant Isolation',
          value: 'Strict per-organization isolation (orgId) enforced by Firestore Security Rules',
        },
      ],
      sections: [
        {
          id: 'overview',
          number: '01',
          title: 'Overview & Application Scope',
          paragraphs: [
            'AL EQFAL is a multi-tenant cloud platform for managing daily shift closings, cash drawers, POS card sales, shift expenses, and branch reconciliation for retail stores, restaurants, cafes, and commercial enterprises.',
            'This policy applies to visitors, organization owners, managers, and employees using the AL EQFAL web application.',
          ],
        },
        {
          id: 'data-collected',
          number: '02',
          title: 'Data We Collect & Process',
          paragraphs: [
            'The application collects and processes only the operational and identity data required to run shift closings and enforce role-based access control for each organization:',
          ],
          bullets: [
            'Manager & Organization Owner Account Data (via Google Sign-In in Firebase Authentication): unique user ID (UID), Google provider subject ID (sub), display name, email address, and email verification status.',
            'Employee Account Data (provisioned by the organization manager using email and password): display name, email address, optional phone number, assigned branch, role, permission flags, and active status.',
            'Organization & Branch Records: organization name, business activity type, primary currency, optional commercial registration number, and branch details (name, code, optional address and phone, active status).',
            'Shift Closing Records: shift date, period (morning/evening), cash sales, POS card sales, expenses, calculated totals, optional notes, workflow status (draft, pending_review, approved, rejected), employee and reviewer identifiers, rejection remarks, and administrative correction details with prior values.',
            'Audit Logs & Archive Index: immutable audit trail entries (auditLogs) for key operational and administrative actions, plus a closing archive index (closingArchives) storing Google Drive file IDs, filenames, links, SHA-256 payload hashes, and revision numbers.',
            'Local Browser Preferences: UI language (aleqfal_lang) and dark/light theme preference (aleqfal_theme) stored in browser localStorage, alongside standard Firebase Authentication session state.',
            'Landing Page Contact Form (#contact): captures name, email, optional organization name, and message for local UI confirmation only; in the current version, this form does not transmit messages to a remote mail server or store them in Firestore.',
          ],
        },
        {
          id: 'purposes',
          number: '03',
          title: 'How Data Is Used',
          paragraphs: [
            'Collected data is used strictly for operating the accounting and shift-closing features described below. AL EQFAL does not sell user data or share it with third-party advertisers:',
          ],
          bullets: [
            'Authenticating owners, managers, and employees and enforcing tenant isolation and role permissions.',
            'Computing shift totals, expected cash drawer balances, and net period figures with integer-halala precision, and preventing duplicate shift entries per branch, date, and period.',
            'Enabling managers to review, approve, reject, or perform documented administrative corrections on shift closings.',
            'Generating downloadable CSV and Excel (.xlsx) financial reports, and archiving verified Excel closing workbooks into the organization owner’s Google Drive with SHA-256 integrity verification.',
          ],
        },
        {
          id: 'firebase-storage',
          number: '04',
          title: 'Firebase Storage & Multi-Tenant Isolation',
          paragraphs: [
            'Organizations, user profiles, branches, shift closings, audit logs, and closing archive metadata are stored in Google Cloud Firestore.',
            'Firestore Security Rules enforce strict isolation by organization ID (orgId), block cross-tenant access, deny read/write access to deactivated employees (isActive = false), and prevent unauthorized edits to approved closings or immutable audit logs.',
          ],
        },
        {
          id: 'google-drive-oauth',
          number: '05',
          title: 'Google Drive Integration & OAuth Authorization',
          paragraphs: [
            'Google Drive linking is authorized strictly per organization by its verified owner (ownerId) using Google Identity Services. Employees and non-owner managers cannot link or modify Drive settings. Submitting new shift closings requires an active, write-verified Drive connection for the organization.',
          ],
          bullets: [
            'Requested Scopes: AL EQFAL requests only openid, email, and https://www.googleapis.com/auth/drive.file.',
            'Limited File Access (drive.file): The application can only create, read, and update folders and Excel (.xlsx) files that it creates inside the owner’s Google Drive (structured by organization, branch, and YYYY-MM). It cannot access, read, modify, or delete unrelated files in your Google Drive.',
            'Ephemeral Token Handling: OAuth access tokens reside strictly in browser RAM, keyed by organization ID (orgId). Access tokens are never stored in Firestore, localStorage, or sessionStorage, and are cleared upon sign-out, account change, organization switch, or expiration.',
            'Persisted Link Metadata: Firestore stores only the linked Drive email, account name, Google subject ID (sub), folder/file IDs and links, and write/read verification status.',
          ],
        },
        {
          id: 'retention-export-control',
          number: '06',
          title: 'Data Retention, Export & Disconnection',
          paragraphs: [
            'Because AL EQFAL maintains accounting and audit records, data lifecycle controls reflect the live Firestore Security Rules and application features:',
          ],
          bullets: [
            'No Client-Side Record Deletion: Current Firestore Security Rules prohibit client deletion (allow delete: if false) for organizations, users, branches, closings, closing archives, and audit logs to preserve accounting integrity.',
            'Account & Branch Deactivation: Managers can deactivate employee accounts or branches (isActive = false) to revoke operational access immediately while retaining historical records.',
            'Disconnecting Google Drive: The organization owner can disconnect Google Drive from Organization Settings at any time. Disconnecting clears the in-memory OAuth session and removes Drive connection metadata from the organization record without deleting or modifying any folders or Excel files stored in the owner’s Google Drive.',
            'Data Export: Managers can export filtered shift reports locally in CSV or Excel (.xlsx) format and download archived Excel workbooks from their linked Google Drive.',
          ],
        },
        {
          id: 'inquiries',
          number: '07',
          title: 'Contact & Data Inquiries',
          paragraphs: [
            'Employees with questions regarding their account profile or branch closing records should contact their organization manager or owner directly.',
            'Visitors and organization owners with technical or privacy inquiries may use the Contact Us section (#contact) on the home page.',
          ],
        },
      ],
    },
  },

  terms: {
    ar: {
      eyebrow: 'الوثيقة الرسمية لشروط وضوابط الاستخدام',
      title: 'شروط الاستخدام',
      subtitle:
        'تحدد هذه الشروط القواعد المنظمة لاستخدام نظام «الإقفال | AL EQFAL» ومسؤوليات مالك المؤسسة والمدير والموظفين وحدود الخدمة وفق الإمكانات الفعلية المتوفرة في المنصة.',
      effectiveDateLabel: 'آخر تحديث',
      effectiveDateValue: '14 نوفمبر 2026',
      scopeLabel: 'النطاق',
      scopeValue: 'تطبيق الويب الإقفال | AL EQFAL',
      summaryPoints: [
        {
          label: 'ملكية الأرشيف',
          value: 'تُحفظ ملفات Excel في حساب Google Drive الخاص بمالك المؤسسة',
        },
        {
          label: 'صلاحية الربط',
          value: 'محصورة في مالك المؤسسة المعتمد (ownerId) فقط',
        },
        {
          label: 'حالة الاعتماد',
          value: 'الإقفال المعتمد مقفل أمام تعديل الموظف وخاضع لسجل الرقابة',
        },
      ],
      sections: [
        {
          id: 'acceptance',
          number: '01',
          title: 'القبول وطبيعة الخدمة',
          paragraphs: [
            'باستخدامك لنظام «الإقفال | AL EQFAL» أو إنشاء حساب مؤسسة أو موظف فيه، فإنك توافق على الالتزام بهذه الشروط.',
            'النظام أداة تقنية مساعدة لتسجيل الورديات اليومية وإقفال الصناديق ومراجعتها وأرشفتها، ولا يُعد بديلاً عن المحاسب القانوني المعتمد أو المراجعة الضريبية والنظامية الرسمية. ولا تتضمن المنصة في مرحلتها الحالية بوابات دفع أو اشتراكات مدفوعة.',
          ],
        },
        {
          id: 'roles-responsibilities',
          number: '02',
          title: 'مسؤوليات مالك المؤسسة والمدير والموظفين',
          paragraphs: [
            'يقوم النظام على فصل واضح للصلاحيات بين الأدوار الوظيفية داخل كل مؤسسة:',
          ],
          bullets: [
            'مسؤوليات مالك المؤسسة: يلتزم مالك المؤسسة بصحة بيانات التأسيس، وحماية حساب Google المرتبط بملكيته، وتفويض وربط حساب Google Drive الخاص بالمؤسسة وإجراء فحص الجاهزية، وتعيين الفروع والموظفين وإدارة تفعيلهم أو تعطيلهم.',
            'مسؤوليات المدير: يتحمل المدير مسؤولية مراجعة أرقام الإقفالات المرسلة من الموظفين واعتمادها أو إرجاعها للتعديل مع ذكر السبب، كما يتحمل مسؤولية أي تصحيح إداري لاحق على إقفال معتمد (مع توثيق سبب التصحيح، وهو إجراء يُسجّل بشكل دائم في سجل الرقابة ولا يمكن التراجع عنه بالحذف).',
            'مسؤوليات الموظف: يُنشأ حساب الموظف بواسطة المدير، ويلتزم الموظف بالمحافظة على سرية بريده وكلمة مروره، وإدخال مبالغ النقد والشبكة والمصروفات بدقة وأمانة ضمن الفرع المعين له فقط. وبمجرد اعتماد الإقفال، لا يمكن للموظف تعديله.',
          ],
        },
        {
          id: 'drive-integration-terms',
          number: '03',
          title: 'شروط استخدام تكامل Google Drive',
          paragraphs: [
            'يتطلب إنشاء وإرسال إقفالات ورديات جديدة أن تكون المؤسسة مربوطة بحساب Google Drive الخاص بمالكها وأن تجتاز فحص الكتابة والقراءة.',
          ],
          bullets: [
            'يستخدم النظام نطاق drive.file فقط لإنشاء وتحديث مجلدات المؤسسة والفروع والأشهر وملفات Excel (.xlsx) الخاصة بالإقفالات المعتمدة.',
            'يلتزم مالك المؤسسة بعدم حذف أو نقل المجلدات والملفات التي أنشأها النظام في Google Drive أثناء استمرار الربط، لأن ذلك قد يعطل فحص الجاهزية أو التحقق من الأرشيف.',
            'نظراً لأن رمز وصول Google Drive يُحفظ مؤقتاً في ذاكرة المتصفح (RAM) فقط، قد يُطلب من مالك المؤسسة إعادة التفويض عبر نافذة Google عند انتهاء الجلسة أو تسجيل الدخول من متصفح جديد لإجراء المزامنة أو الفحص أو الأرشفة.',
          ],
        },
        {
          id: 'acceptable-use',
          number: '04',
          title: 'الاستخدام المقبول والقيود الأمنية',
          paragraphs: [
            'يُحظر على أي مستخدم إساءة استخدام المنصة أو محاولة تجاوز ضوابط العزل والأمان المطبقة فيها، ويشمل ذلك:',
          ],
          bullets: [
            'محاولة الوصول إلى بيانات مؤسسة أو فرع غير مصرح له بالوصول إليه، أو التحايل على قواعد Firestore Security Rules.',
            'محاولة تعديل الإقفالات المعتمدة بطرق غير نظامية أو التلاعب بسجلات الرقابة (auditLogs) غير القابلة للتعديل والحذف.',
            'ربط حساب Google Drive لا يخص مالك المؤسسة المعتمد، أو مشاركة بيانات الدخول بين عدة أشخاص بما يخل بدقة نسبة العمليات لمسؤول الصندوق أو المدير.',
          ],
        },
        {
          id: 'liability-limits',
          number: '05',
          title: 'دقة البيانات المحاسبية وحدود المسؤولية',
          paragraphs: [
            'يحتسب النظام المجاميع المحاسبية (إجمالي المبيعات، الباقي في الصندوق، وصافي الفترة) آلياً بدقة الهللة استناداً إلى الأرقام التي يدخلها المستخدمون.',
            'تقع مسؤولية مطابقة النقد الفعلي في الصندوق وإيصالات أجهزة الدفع الإلكتروني مع القيم المسجلة على عاتق إدارة وموظفي المؤسسة.',
            'يُقدّم النظام وفق حالته التشغيلية الحالية («كما هو») عبر خدمات Google Firebase وGoogle Drive، ولا يتحمل مطوّرو التطبيق مسؤولية الأعطال الخارجة عن السيطرة في خدمات الطرف الثالث أو انقطاع الإنترنت أو حذف المالك لملفات من داخل حسابه في Google Drive.',
          ],
        },
        {
          id: 'updates-contact',
          number: '06',
          title: 'تحديث الشروط والتواصل',
          paragraphs: [
            'قد يتم تحديث هذه الشروط مستقبلاً لمواكبة أي تطورات وظيفية أو تقنية في النظام مع تحديث التاريخ الظاهر أعلى الصفحة.',
            'لأي استفسارات تشغيلية أو نظامية حول هذه الشروط، يمكن استخدام قسم «تواصل معنا» (#contact) في الصفحة الرئيسية.',
          ],
        },
      ],
    },
    en: {
      eyebrow: 'Official Terms & Conditions of Use',
      title: 'Terms of Service',
      subtitle:
        'These Terms govern the use of AL EQFAL, outlining the responsibilities of organization owners, managers, and employees as well as the operational boundaries of the live system.',
      effectiveDateLabel: 'Last Updated',
      effectiveDateValue: 'November 14, 2026',
      scopeLabel: 'Scope',
      scopeValue: 'AL EQFAL Web Application',
      summaryPoints: [
        {
          label: 'Archive Ownership',
          value: 'Generated Excel workbooks are stored in the organization owner’s own Google Drive',
        },
        {
          label: 'Drive Authorization',
          value: 'Restricted exclusively to the verified organization owner (ownerId)',
        },
        {
          label: 'Approved Records',
          value: 'Locked against employee modification and tracked in immutable audit logs',
        },
      ],
      sections: [
        {
          id: 'acceptance',
          number: '01',
          title: 'Acceptance & Nature of Service',
          paragraphs: [
            'By accessing AL EQFAL or creating an organization or employee account, you agree to these Terms of Service.',
            'AL EQFAL is an operational shift-closing and cash-reconciliation web tool. It does not replace certified public accountants, tax advisors, or statutory financial audits. No payment gateways or paid subscription tiers are active in the current version.',
          ],
        },
        {
          id: 'roles-responsibilities',
          number: '02',
          title: 'Responsibilities of Owners, Managers & Employees',
          paragraphs: [
            'Access and operational accountability are separated by role within each organization:',
          ],
          bullets: [
            'Organization Owner: Responsible for accurate organization onboarding details, safeguarding the owner Google account, linking and maintaining the organization’s Google Drive readiness check, and overseeing branch and user provisioning.',
            'Manager: Responsible for reviewing submitted shift closings, approving or returning them for revision with clear remarks, and justifying any documented administrative correction to an approved closing (all administrative corrections are permanently logged in the audit trail).',
            'Employee: Provisioned by the organization manager, responsible for keeping login credentials confidential and entering cash, card, and expense figures accurately for their assigned branch. Once a closing is approved, employees cannot alter it.',
          ],
        },
        {
          id: 'drive-integration-terms',
          number: '03',
          title: 'Google Drive Integration Terms',
          paragraphs: [
            'Creating and submitting new shift closings requires an active, write-verified Google Drive connection linked to the organization owner’s account.',
          ],
          bullets: [
            'AL EQFAL operates strictly under the drive.file scope to manage its own organization, branch, and monthly folders and to upload/download verified Excel (.xlsx) closing reports.',
            'The organization owner is responsible for not manually deleting or breaking app-created Drive folders while the integration remains active.',
            'Because Drive OAuth access tokens are stored strictly in browser RAM, the organization owner may be prompted to re-authorize via Google when the temporary token expires or when signing in from another browser session.',
          ],
        },
        {
          id: 'acceptable-use',
          number: '04',
          title: 'Acceptable Use & Security Restrictions',
          paragraphs: [
            'Users must not misuse the platform or attempt to bypass tenant isolation and security controls, including:',
          ],
          bullets: [
            'Attempting to access data belonging to another organization or branch, or circumventing Firestore Security Rules.',
            'Attempting to alter locked approved closings outside authorized workflows or tampering with immutable audit logs (auditLogs).',
            'Linking a Google Drive account that does not belong to the verified organization owner, or sharing employee credentials across individuals.',
          ],
        },
        {
          id: 'liability-limits',
          number: '05',
          title: 'Accounting Accuracy & Limitation of Liability',
          paragraphs: [
            'AL EQFAL automatically computes total sales, expected cash in drawer, and net period amounts with integer-halala precision based solely on user-entered figures.',
            'Physical cash verification and matching POS settlement receipts remain the responsibility of the organization’s staff and management.',
            'The service is provided on an "as-is" basis relying on Google Firebase and Google Drive infrastructure. The application developers are not liable for third-party cloud outages, network interruptions, or files manually removed by an owner from their Google Drive.',
          ],
        },
        {
          id: 'updates-contact',
          number: '06',
          title: 'Updates & Inquiries',
          paragraphs: [
            'These Terms may be updated as the platform evolves, with the effective date reflected at the top of this page.',
            'For operational or terms-related questions, please use the Contact Us section (#contact) on the home page.',
          ],
        },
      ],
    },
  },
};
