import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const en = {
  nav: { home: "Home", explore: "Explore", record: "Create", competitions: "Compete", profile: "Profile" },
  common: {
    follow: "Follow", following: "Following", like: "Like", comment: "Comment", share: "Share",
    gift: "Gift", send: "Send", cancel: "Cancel", publish: "Publish", save: "Save",
    preview: "Preview", record: "Record", stop: "Stop", enter: "Enter", vote: "Vote",
    live: "LIVE", trending: "Trending", new: "New", top: "Top", all: "All",
    balance: "Balance", withdraw: "Withdraw", buy: "Buy Coins",
  },
  feed: { competition: "Enter Competition", original: "Original", cover: "Cover", teaser: "Teaser", djset: "DJ Set" },
  explore: { search: "Search artists, songs, DJs...", artists: "Artists", songs: "Songs", djs: "DJs", producers: "Producers", genres: "Genres" },
  record: {
    title: "Studio", karaoke: "Choose Karaoke", vocal: "Vocal", autotune: "AutoTune", pitch: "Pitch",
    speed: "Speed", key: "Key", noise: "Noise Removal", enhance: "AI Enhance",
    reverb: "Reverb", eq: "EQ", compression: "Compression", master: "Auto Master",
    export: "Export Studio Version", sendComp: "Send to Competition",
  },
  upload: {
    title: "Upload", pickType: "What are you sharing?", caption: "Caption", description: "Description",
    category: "Category", tags: "Tags", credits: "Credits", writer: "Writer", composer: "Composer",
    producer: "Producer", arranger: "Arranger", performer: "Performer", visibility: "Visibility",
    public: "Public", private: "Private",
  },
  comp: {
    title: "Competitions", active: "Active", upcoming: "Upcoming", finished: "Finished",
    rounds: "Rounds", quarter: "Quarterfinals", semi: "Semifinals", final: "Final",
    prize: "Prize Pool", participants: "Participants", join: "Join Competition",
  },
  live: { title: "Live", battle: "Battle", chat: "Live Chat", invite: "Invite Guest", viewers: "viewers" },
  profile: {
    edit: "Edit Profile", followers: "Followers", following: "Following", likes: "Likes",
    videos: "Videos", songs: "Songs", covers: "Covers", live: "Live", competitions: "Competitions",
    about: "About", discography: "Discography", verified: "Verified Artist",
  },
  wallet: {
    title: "Wallet", coins: "Coins", earnings: "Earnings", history: "History",
    gifts: { mic: "Golden Mic", disc: "Gold Disc", diamond: "Diamond", crown: "Crown", rose: "Rose", rocket: "Rocket" },
  },
  notif: { title: "Notifications", liked: "liked your post", followed: "started following you", gifted: "sent you a gift", commented: "commented on your post", invited: "invited you to a competition" },
  label: { title: "Label Hub", find: "Find Talent", audition: "Post Audition", filter: "Filter by voice / genre", contact: "Contact Artist" },
};

const he = {
  nav: { home: "בית", explore: "גילוי", record: "צור", competitions: "תחרויות", profile: "פרופיל" },
  common: {
    follow: "עקוב", following: "עוקב", like: "לייק", comment: "תגובה", share: "שתף",
    gift: "מתנה", send: "שלח", cancel: "ביטול", publish: "פרסם", save: "שמור",
    preview: "תצוגה", record: "הקלט", stop: "עצור", enter: "הרשם", vote: "הצבע",
    live: "לייב", trending: "טרנד", new: "חדש", top: "מובילים", all: "הכל",
    balance: "יתרה", withdraw: "משיכה", buy: "רכוש מטבעות",
  },
  feed: { competition: "להשתתף בתחרות", original: "מקורי", cover: "קאבר", teaser: "טיזר", djset: "DJ Set" },
  explore: { search: "חפש אמנים, שירים, DJs...", artists: "אמנים", songs: "שירים", djs: "DJs", producers: "מפיקים", genres: "ז'אנרים" },
  record: {
    title: "אולפן", karaoke: "בחר קריוקי", vocal: "ווקאל", autotune: "AutoTune", pitch: "טונאליות",
    speed: "מהירות", key: "סולם", noise: "הסרת רעש", enhance: "שיפור AI",
    reverb: "ריוורב", eq: "EQ", compression: "דחיסה", master: "מאסטרינג אוטומטי",
    export: "ייצא גרסת אולפן", sendComp: "שלח לתחרות",
  },
  upload: {
    title: "העלאה", pickType: "מה אתה משתף?", caption: "כותרת", description: "תיאור",
    category: "קטגוריה", tags: "תגיות", credits: "קרדיטים", writer: "כותב", composer: "מלחין",
    producer: "מפיק", arranger: "מעבד", performer: "מבצע", visibility: "נראות",
    public: "ציבורי", private: "פרטי",
  },
  comp: {
    title: "תחרויות", active: "פעילות", upcoming: "קרובות", finished: "הסתיימו",
    rounds: "שלבים", quarter: "רבע גמר", semi: "חצי גמר", final: "גמר",
    prize: "סכום פרס", participants: "משתתפים", join: "הצטרף לתחרות",
  },
  live: { title: "לייב", battle: "קרב שירה", chat: "צ'אט חי", invite: "הזמן אורח", viewers: "צופים" },
  profile: {
    edit: "עריכת פרופיל", followers: "עוקבים", following: "עוקב", likes: "לייקים",
    videos: "וידאו", songs: "שירים", covers: "קאברים", live: "לייב", competitions: "תחרויות",
    about: "אודות", discography: "דיסקוגרפיה", verified: "אמן מאומת",
  },
  wallet: {
    title: "ארנק", coins: "מטבעות", earnings: "הכנסות", history: "היסטוריה",
    gifts: { mic: "מיקרופון זהב", disc: "תקליט זהב", diamond: "יהלום", crown: "כתר", rose: "ורד", rocket: "רקטה" },
  },
  notif: { title: "התראות", liked: "אהב את הפוסט שלך", followed: "התחיל לעקוב אחריך", gifted: "שלח לך מתנה", commented: "הגיב על הפוסט שלך", invited: "הזמין אותך לתחרות" },
  label: { title: "מרכז לייבלים", find: "חפש כישרונות", audition: "פרסם אודישן", filter: "סינון לפי קול / ז'אנר", contact: "צור קשר עם האמן" },
};

const ar = {
  nav: { home: "الرئيسية", explore: "استكشف", record: "إنشاء", competitions: "المسابقات", profile: "الملف" },
  common: {
    follow: "متابعة", following: "متابَع", like: "إعجاب", comment: "تعليق", share: "مشاركة",
    gift: "هدية", send: "إرسال", cancel: "إلغاء", publish: "نشر", save: "حفظ",
    preview: "معاينة", record: "تسجيل", stop: "إيقاف", enter: "تسجيل", vote: "تصويت",
    live: "مباشر", trending: "رائج", new: "جديد", top: "الأعلى", all: "الكل",
    balance: "الرصيد", withdraw: "سحب", buy: "شراء عملات",
  },
  feed: { competition: "دخول المسابقة", original: "أصلي", cover: "كافر", teaser: "تشويقة", djset: "DJ Set" },
  explore: { search: "ابحث عن فنانين، أغاني، DJs...", artists: "فنانون", songs: "أغاني", djs: "DJs", producers: "منتجون", genres: "أنواع" },
  record: {
    title: "الاستوديو", karaoke: "اختر كاريوكي", vocal: "الصوت", autotune: "AutoTune", pitch: "طبقة الصوت",
    speed: "السرعة", key: "السلم", noise: "إزالة الضوضاء", enhance: "تحسين AI",
    reverb: "صدى", eq: "EQ", compression: "ضغط", master: "ماسترينج تلقائي",
    export: "تصدير نسخة الاستوديو", sendComp: "إرسال للمسابقة",
  },
  upload: {
    title: "رفع", pickType: "ماذا تشارك؟", caption: "العنوان", description: "الوصف",
    category: "الفئة", tags: "الوسوم", credits: "الاعتمادات", writer: "كاتب", composer: "ملحن",
    producer: "منتج", arranger: "موزع", performer: "مؤدي", visibility: "الظهور",
    public: "عام", private: "خاص",
  },
  comp: {
    title: "المسابقات", active: "نشطة", upcoming: "قادمة", finished: "منتهية",
    rounds: "الجولات", quarter: "ربع النهائي", semi: "نصف النهائي", final: "النهائي",
    prize: "الجائزة", participants: "المشاركون", join: "انضم للمسابقة",
  },
  live: { title: "مباشر", battle: "معركة غناء", chat: "دردشة مباشرة", invite: "دعوة ضيف", viewers: "مشاهد" },
  profile: {
    edit: "تعديل الملف", followers: "متابعون", following: "يتابع", likes: "إعجابات",
    videos: "فيديوهات", songs: "أغاني", covers: "كافرات", live: "مباشر", competitions: "مسابقات",
    about: "حول", discography: "الأعمال", verified: "فنان موثق",
  },
  wallet: {
    title: "المحفظة", coins: "عملات", earnings: "أرباح", history: "السجل",
    gifts: { mic: "مايك ذهبي", disc: "قرص ذهبي", diamond: "ألماسة", crown: "تاج", rose: "وردة", rocket: "صاروخ" },
  },
  notif: { title: "الإشعارات", liked: "أعجب بمنشورك", followed: "بدأ بمتابعتك", gifted: "أرسل لك هدية", commented: "علّق على منشورك", invited: "دعاك للمسابقة" },
  label: { title: "مركز الليبل", find: "ابحث عن مواهب", audition: "انشر تجربة أداء", filter: "تصفية حسب الصوت / النوع", contact: "تواصل مع الفنان" },
};

/**
 * Country → default language mapping (TikTok-style: detect region, pick language).
 * Overridden by explicit user selection (persisted in localStorage).
 */
const countryToLang: Record<string, string> = {
  IL: "he",
  SA: "ar", AE: "ar", EG: "ar", JO: "ar", LB: "ar", SY: "ar", IQ: "ar",
  KW: "ar", QA: "ar", BH: "ar", OM: "ar", YE: "ar", PS: "ar", MA: "ar",
  DZ: "ar", TN: "ar", LY: "ar", SD: "ar",
};

function guessFromLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages || [navigator.language];
  for (const l of langs) {
    const lower = l.toLowerCase();
    if (lower.startsWith("he") || lower.startsWith("iw")) return "he";
    if (lower.startsWith("ar")) return "ar";
    const region = lower.split("-")[1]?.toUpperCase();
    if (region && countryToLang[region]) return countryToLang[region];
  }
  return "en";
}

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        en: { translation: en },
        he: { translation: he },
        ar: { translation: ar },
      },
      fallbackLng: "en",
      supportedLngs: ["en", "he", "ar"],
      lng: typeof window !== "undefined" ? (localStorage.getItem("lang") ?? guessFromLocale()) : "en",
      interpolation: { escapeValue: false },
      detection: { order: ["localStorage", "navigator"], caches: ["localStorage"], lookupLocalStorage: "lang" },
    });
}

export const rtlLangs = new Set(["he", "ar"]);
export function isRTL(lng: string) { return rtlLangs.has(lng); }

export function setLanguage(lng: string) {
  i18n.changeLanguage(lng);
  if (typeof window !== "undefined") {
    localStorage.setItem("lang", lng);
    document.documentElement.lang = lng;
    document.documentElement.dir = isRTL(lng) ? "rtl" : "ltr";
  }
}

export default i18n;
