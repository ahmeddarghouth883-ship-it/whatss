/** Static legal / contact copy for public routes (en, fr, ar, it). */

function readEnvString(key) {
  try {
    const v = import.meta.env?.[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return '';
}

export const PUBLIC_CONTACT_EMAIL = (() => {
  const v = readEnvString('VITE_PUBLIC_CONTACT_EMAIL');
  return v.includes('@') ? v : 'support@whispflow.com';
})();

export const PUBLIC_REGISTERED_ADDRESS = (() => {
  const v = readEnvString('VITE_PUBLIC_REGISTERED_ADDRESS');
  return v || 'Tunis, Tunisia';
})();

const privacyEn = {
  title: 'Privacy Policy',
  updated: 'Last updated: April 2026',
  sections: [
    {
      title: 'Overview',
      paragraphs: [
        'WhispFlow (“we”, “us”) respects your privacy. This policy explains what we collect when you use our website and services, how we use it, and your choices.',
        'By using WhispFlow, you agree to this policy. If you do not agree, please do not use the service.',
      ],
    },
    {
      title: 'Data we collect',
      paragraphs: [
        'Account information: name, email, and authentication details you provide when you register or sign in.',
        'Usage and technical data: IP address, browser type, device identifiers, and logs needed to operate and secure the platform.',
        'Content you submit: campaign data, leads, messages, and files you upload or send through the product, as needed to provide the service.',
      ],
    },
    {
      title: 'How we use data',
      paragraphs: [
        'We use data to provide and improve WhispFlow, authenticate users, process payments where applicable, detect abuse, comply with law, and communicate service-related notices.',
        'We do not sell your personal information. We may share data with subprocessors who help us host, analyze, or operate the service, under appropriate agreements.',
      ],
    },
    {
      title: 'Retention & security',
      paragraphs: [
        'We retain information as long as your account is active or as needed for legal, security, or operational purposes. You may request deletion subject to applicable law and legitimate business needs.',
        'We implement technical and organizational measures to protect data; no method of transmission over the internet is 100% secure.',
      ],
    },
    {
      title: 'Your rights',
      paragraphs: [
        'Depending on your location, you may have rights to access, correct, delete, or restrict processing of your personal data, or to object to certain processing. Contact us to exercise these rights.',
      ],
    },
    {
      title: 'Cookies & similar technologies',
      paragraphs: [
        'We use essential cookies and similar technologies to maintain sessions, remember preferences such as language and theme, understand aggregate product usage, and protect against abuse. Where applicable, you can control non-essential cookies through your browser settings.',
      ],
    },
    {
      title: 'Contact',
      paragraphs: [
        `Questions about privacy: ${PUBLIC_CONTACT_EMAIL}`,
      ],
    },
  ],
};

const termsEn = {
  title: 'Terms of Service',
  updated: 'Last updated: April 2026',
  sections: [
    {
      title: 'Agreement',
      paragraphs: [
        'These Terms govern your use of WhispFlow’s website, applications, and related services. By creating an account or using the service, you agree to these Terms.',
      ],
    },
    {
      title: 'Account & eligibility',
      paragraphs: [
        'You must provide accurate registration information and keep credentials secure. You are responsible for activity under your account.',
        'You must comply with applicable laws, Meta/WhatsApp policies, and anti-spam rules when sending messages or extracting leads.',
      ],
    },
    {
      title: 'Credits, billing, and plans',
      paragraphs: [
        'Fees, credits, and plan details are presented at purchase or in-product. Unless stated otherwise, subscriptions renew according to the terms shown in your account.',
        'You are responsible for any taxes applicable to your use of the service.',
      ],
    },
    {
      title: 'Acceptable use',
      paragraphs: [
        'You may not use WhispFlow for unlawful activity, harassment, fraud, or to violate third-party rights. We may suspend or terminate accounts that breach these Terms or put the platform at risk.',
      ],
    },
    {
      title: 'Disclaimer & limitation',
      paragraphs: [
        'The service is provided “as available” without warranties of uninterrupted or error-free operation. To the maximum extent permitted by law, our liability is limited as set forth in your agreement or applicable law.',
      ],
    },
    {
      title: 'Changes',
      paragraphs: [
        'We may update these Terms; material changes will be communicated as appropriate. Continued use after changes constitutes acceptance where permitted by law.',
      ],
    },
    {
      title: 'Governing law & disputes',
      paragraphs: [
        'These Terms are governed by the laws of Tunisia, excluding conflict-of-law principles that would require another jurisdiction’s laws, except where mandatory consumer protections in your country apply.',
        'Please contact us first so we can try to resolve concerns informally.',
      ],
    },
    {
      title: 'Contact',
      paragraphs: [
        `Legal questions: ${PUBLIC_CONTACT_EMAIL}`,
      ],
    },
  ],
};

const contactEn = {
  title: 'Contact',
  intro:
    'Reach out for product questions, billing, security, or legal notices. We aim to respond within a few business days. For formal legal correspondence, use email with the subject line “Legal notice”.',
  rows: [
    { label: 'Email', value: PUBLIC_CONTACT_EMAIL, href: `mailto:${PUBLIC_CONTACT_EMAIL}` },
    { label: 'Registered office', value: PUBLIC_REGISTERED_ADDRESS },
    { label: 'Company', value: 'WhispFlow' },
  ],
};

function T(privacy, terms, contact) {
  return { privacy, terms, contact };
}

export const legalPagesCopy = {
  en: T(privacyEn, termsEn, contactEn),
  fr: T(
    {
      ...privacyEn,
      title: 'Politique de confidentialité',
      updated: 'Dernière mise à jour : avril 2026',
      sections: privacyEn.sections.map((s, i) => {
        if (i === 0) {
          return {
            title: 'Présentation',
            paragraphs: [
              'WhispFlow (« nous ») respecte votre vie privée. Cette politique explique ce que nous collectons lorsque vous utilisez notre site et nos services, comment nous l’utilisons, et vos choix.',
              'En utilisant WhispFlow, vous acceptez cette politique. Sinon, veuillez ne pas utiliser le service.',
            ],
          };
        }
        if (s.title === 'Cookies & similar technologies') {
          return {
            title: 'Cookies et technologies similaires',
            paragraphs: [
              'Nous utilisons des cookies essentiels et des technologies similaires pour maintenir les sessions, mémoriser les préférences (langue, thème), comprendre l’usage agrégé du produit et lutter contre les abus. Le cas échéant, vous pouvez limiter les cookies non essentiels dans les paramètres du navigateur.',
            ],
          };
        }
        if (i === privacyEn.sections.length - 1) {
          return { title: 'Contact', paragraphs: [`Questions confidentialité : ${PUBLIC_CONTACT_EMAIL}`] };
        }
        return s;
      }),
    },
    {
      ...termsEn,
      title: 'Conditions d’utilisation',
      updated: 'Dernière mise à jour : avril 2026',
      sections: termsEn.sections.map((s, i) => {
        if (s.title === 'Governing law & disputes') {
          return {
            title: 'Droit applicable et litiges',
            paragraphs: [
              'Les présentes Conditions sont régies par le droit tunisien, sans égard aux règles de conflit de lois qui imposeraient une autre juridiction, sauf protections impératives applicables dans votre pays.',
              'Contactez-nous d’abord : nous cherchons en priorité à résoudre les litiges à l’amiable.',
            ],
          };
        }
        if (i === termsEn.sections.length - 1) {
          return { title: 'Contact', paragraphs: [`Questions juridiques : ${PUBLIC_CONTACT_EMAIL}`] };
        }
        return s;
      }),
    },
    {
      title: 'Contact',
      intro:
        'Pour le produit, la facturation, la sécurité ou les mentions légales. Réponse visée sous quelques jours ouvrés. Pour une correspondance juridique formelle, indiquez l’objet « Legal notice ».',
      rows: [
        { label: 'E-mail', value: PUBLIC_CONTACT_EMAIL, href: `mailto:${PUBLIC_CONTACT_EMAIL}` },
        { label: 'Siège / adresse', value: PUBLIC_REGISTERED_ADDRESS },
        { label: 'Société', value: 'WhispFlow' },
      ],
    }
  ),
  ar: T(
    {
      ...privacyEn,
      title: 'سياسة الخصوصية',
      updated: 'آخر تحديث: أبريل 2026',
      sections: privacyEn.sections.map((s, i) => {
        if (i === 0) {
          return {
            title: 'نظرة عامة',
            paragraphs: [
              'تحترم WhispFlow («نحن») خصوصيتك. توضح هذه السياسة ما نجمعه عند استخدام موقعنا وخدماتنا، وكيف نستخدمه، وخياراتك.',
              'باستخدام WhispFlow فإنك توافق على هذه السياسة. إذا لم توافق، يرجى عدم استخدام الخدمة.',
            ],
          };
        }
        if (s.title === 'Cookies & similar technologies') {
          return {
            title: 'ملفات تعريف الارتباط والتقنيات المشابهة',
            paragraphs: [
              'نستخدم ملفات تعريف ارتباط أساسية وتقنيات مشابهة للحفاظ على الجلسات، وتذكّر التفضيلات مثل اللغة والمظهر، وفهم استخدام المنتج بشكل مجمّع، والحماية من إساءة الاستخدام. حيث ينطبق ذلك، يمكنك التحكم في ملفات غير الأساسية من إعدادات المتصفح.',
            ],
          };
        }
        if (i === privacyEn.sections.length - 1) {
          return { title: 'تواصل', paragraphs: [`استفسارات الخصوصية: ${PUBLIC_CONTACT_EMAIL}`] };
        }
        return s;
      }),
    },
    {
      ...termsEn,
      title: 'شروط الخدمة',
      updated: 'آخر تحديث: أبريل 2026',
      sections: termsEn.sections.map((s, i) => {
        if (s.title === 'Governing law & disputes') {
          return {
            title: 'القانون الواجب التطبيق والنزاعات',
            paragraphs: [
              'تخضع هذه الشروط لقوانين تونس، دون مراعاة قواعد تنازع القوانين التي تفرض قانوناً آخر، باستثناء الحماية الإلزامية للمستهلك في بلدك إن وُجدت.',
              'يُرجى التواصل معنا أولاً لمحاولة حل أي خلاف ودياً.',
            ],
          };
        }
        if (i === termsEn.sections.length - 1) {
          return { title: 'تواصل', paragraphs: [`الاستفسارات القانونية: ${PUBLIC_CONTACT_EMAIL}`] };
        }
        return s;
      }),
    },
    {
      title: 'اتصل بنا',
      intro:
        'للمنتج أو الفوترة أو الأمان أو الإشعارات القانونية. نهدف للرد خلال أيام عمل قليلة. للمراسلات القانونية الرسمية، استخدم البريد مع سطر الموضوع «Legal notice».',
      rows: [
        { label: 'البريد الإلكتروني', value: PUBLIC_CONTACT_EMAIL, href: `mailto:${PUBLIC_CONTACT_EMAIL}` },
        { label: 'المقر المسجل', value: PUBLIC_REGISTERED_ADDRESS },
        { label: 'الشركة', value: 'WhispFlow' },
      ],
    }
  ),
  it: T(
    {
      ...privacyEn,
      title: 'Informativa sulla privacy',
      updated: 'Ultimo aggiornamento: aprile 2026',
      sections: privacyEn.sections.map((s, i) => {
        if (i === 0) {
          return {
            title: 'Panoramica',
            paragraphs: [
              'WhispFlow («noi») rispetta la tua privacy. Questa informativa spiega cosa raccogliamo quando usi il sito e i servizi, come lo usiamo e quali sono le tue scelte.',
              'Usando WhispFlow accetti questa informativa. Se non sei d’accordo, non utilizzare il servizio.',
            ],
          };
        }
        if (s.title === 'Cookies & similar technologies') {
          return {
            title: 'Cookie e tecnologie simili',
            paragraphs: [
              'Utilizziamo cookie essenziali e tecnologie simili per mantenere le sessioni, ricordare preferenze come lingua e tema, comprendere l’uso aggregato del prodotto e proteggere dagli abusi. Ove applicabile, puoi limitare i cookie non essenziali dalle impostazioni del browser.',
            ],
          };
        }
        if (i === privacyEn.sections.length - 1) {
          return { title: 'Contatto', paragraphs: [`Privacy: ${PUBLIC_CONTACT_EMAIL}`] };
        }
        return s;
      }),
    },
    {
      ...termsEn,
      title: 'Termini di servizio',
      updated: 'Ultimo aggiornamento: aprile 2026',
      sections: termsEn.sections.map((s, i) => {
        if (s.title === 'Governing law & disputes') {
          return {
            title: 'Legge applicabile e controversie',
            paragraphs: [
              'I presenti Termini sono regolati dalla legge tunisina, senza applicazione di norme di conflitto che imporrebbero un’altra giurisdizione, salvo protezioni obbligatorie del consumatore nel tuo Paese.',
              'Ti invitiamo a contattarci prima per cercare una soluzione bonaria.',
            ],
          };
        }
        if (i === termsEn.sections.length - 1) {
          return { title: 'Contatto', paragraphs: [`Questioni legali: ${PUBLIC_CONTACT_EMAIL}`] };
        }
        return s;
      }),
    },
    {
      title: 'Contatto',
      intro:
        'Per il prodotto, fatturazione, sicurezza o comunicazioni legali. Rispondiamo di solito entro pochi giorni lavorativi. Per corrispondenza legale formale, usa l’oggetto «Legal notice».',
      rows: [
        { label: 'Email', value: PUBLIC_CONTACT_EMAIL, href: `mailto:${PUBLIC_CONTACT_EMAIL}` },
        { label: 'Sede legale', value: PUBLIC_REGISTERED_ADDRESS },
        { label: 'Azienda', value: 'WhispFlow' },
      ],
    }
  ),
};
