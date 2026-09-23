import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileText,
  HelpCircle,
  LayoutGrid,
  ListFilter,
  Menu,
  Printer,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type Invoice = {
  id: string;
  number: string;
  client: string;
  clientCode: string;
  date: string;
  amount: number;
  tax: number;
  status: 'Indexed';
  page: number;
  items: { description: string; qty: number; rate: number }[];
};

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const formatPKR = (value: number) =>
  `PKR ${new Intl.NumberFormat('en-PK').format(value || 0)}`;

const parseAmount = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseInvoiceDate = (value: string) => {
  const match = value.match(/^(\d{2})-([A-Z][a-z]{2})-(\d{4})$/);
  if (!match) return new Date(value);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[2]);
  return new Date(Number(match[3]), month, Number(match[1]));
};

const formatDate = (value: string) => {
  const parsed = parseInvoiceDate(value);
  return Number.isNaN(parsed.getTime())
    ? value || 'Date not found'
    : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(parsed);
};

const extractPdfInvoice = (text: string, page: number): Invoice => {
  const find = (pattern: RegExp, fallback = '') =>
    text.match(pattern)?.[1]?.trim() || fallback;
  const invoiceNumber = find(
    /\b(DI-\d{8}|INV[-\w]+)\b/i,
    `PDF-${String(page).padStart(4, '0')}`,
  );
  const date = find(/\b(\d{2}-[A-Z][a-z]{2}-\d{4})\b/);
  const addresses = text.split('Address:\n');
  const client = (
    addresses[1]?.split('\nQuantity')[0] ||
    find(/CUSTOMER DETAILS.*?\nName:\n([^\n]+)/s, 'Unassigned client')
  )
    .replace(/\s+/g, ' ')
    .trim();
  const clientCode = find(/\n([A-Z]\d{5,})\nSale No\. Ref\.:/, 'PDF record');
  const quantity = parseAmount(
    find(/Total Quantity\s*\n\s*([0-9][0-9,.]*)/),
  );
  const tax = parseAmount(
    find(/\n\s*([0-9][0-9,]*)\s*\nTotal Taxes Exclusive Value/),
  );
  const amount = parseAmount(
    find(
      /Total Taxes Exclusive Value.*?\n\s*[0-9][0-9,]*\s*\n\s*[0-9][0-9,]*\s*\n\s*([0-9][0-9,]*)\s*\n\s*[0-9][0-9,]*\s*\nTotal Tax Amount/s,
    ),
  );
  const description = find(/\n\s*\d+\s*\n18%\s*\n([^\n]+)/s, 'Invoice items');

  return {
    id: `pdf-page-${page}`,
    number: invoiceNumber,
    client: client || 'Unassigned client',
    clientCode,
    date,
    amount,
    tax,
    status: 'Indexed',
    page,
    items: [
      {
        description,
        qty: quantity || 1,
        rate: quantity ? amount / quantity : amount,
      },
    ],
  };
};

function StatusPill({ status }: { status: Invoice['status'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e0eee7] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#216147]">
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function App() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sourcePdfBytes, setSourcePdfBytes] = useState<Uint8Array | null>(null);
  const [sourcePdfUrl, setSourcePdfUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [query, setQuery] = useState('');
  const [client, setClient] = useState('All clients');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [dateRange, setDateRange] = useState('All dates');
  const [amountRange, setAmountRange] = useState('Any amount');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [notice, setNotice] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const announce = (message: string) => setNotice(message);
  const openFilePicker = () => fileInputRef.current?.click();

  const loadPdf = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setLoadError(true);
      announce('Please choose a PDF file');
      return;
    }

    setIsLoading(true);
    setLoadError(false);
    setInvoices([]);
    setSelectedIds([]);
    setActiveId('');
    setClient('All clients');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfDocument = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const parsed: Invoice[] = [];

      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => {
            const candidate = item as { str?: string };
            return candidate.str || '';
          })
          .filter(Boolean)
          .join('\n');
        parsed.push(extractPdfInvoice(text, pageNumber));
      }

      if (!parsed.length) throw new Error('No pages found');
      setInvoices(parsed);
      setSourcePdfBytes(bytes);
      setSourcePdfUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
      setFileName(file.name);
      setPageCount(pdfDocument.numPages);
      setActiveId(parsed[0].id);
      announce(`${parsed.length} invoice pages indexed`);
    } catch {
      setLoadError(true);
      setSourcePdfBytes(null);
      setSourcePdfUrl('');
      setFileName('');
      setPageCount(0);
      announce('Could not read this PDF');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void loadPdf(file);
  };

  useEffect(
    () => () => {
      if (sourcePdfUrl) URL.revokeObjectURL(sourcePdfUrl);
    },
    [sourcePdfUrl],
  );

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const clients = useMemo(
    () => ['All clients', ...Array.from(new Set(invoices.map((item) => item.client))).sort()],
    [invoices],
  );
  const latestDate = useMemo(
    () =>
      invoices.reduce((latest, item) => {
        const current = parseInvoiceDate(item.date);
        return current > latest ? current : latest;
      }, new Date(0)),
    [invoices],
  );
  const filtered = useMemo(
    () =>
      invoices.filter((item) => {
        const searchable = `${item.number} ${item.client} ${item.clientCode}`.toLowerCase();
        const date = parseInvoiceDate(item.date);
        const queryMatches = !query || searchable.includes(query.toLowerCase());
        const clientMatches = client === 'All clients' || item.client === client;
        const numberMatches =
          !invoiceNumber || item.number.toLowerCase().includes(invoiceNumber.toLowerCase());
        const dateMatches =
          dateRange === 'All dates' ||
          (dateRange === 'This month' &&
            date.getFullYear() === latestDate.getFullYear() &&
            date.getMonth() === latestDate.getMonth()) ||
          (dateRange === 'Last 90 days' &&
            latestDate.getTime() - date.getTime() <= 90 * 24 * 60 * 60 * 1000);
        const amountMatches =
          amountRange === 'Any amount' ||
          (amountRange === 'Under PKR 300k' && item.amount < 300000) ||
          (amountRange === 'PKR 300k–700k' &&
            item.amount >= 300000 &&
            item.amount <= 700000) ||
          (amountRange === 'Over PKR 700k' && item.amount > 700000);
        return queryMatches && clientMatches && numberMatches && dateMatches && amountMatches;
      }),
    [invoices, query, client, invoiceNumber, dateRange, amountRange, latestDate],
  );
  const active =
    filtered.find((item) => item.id === activeId) ||
    invoices.find((item) => item.id === activeId) ||
    filtered[0];
  const selected = invoices.filter((item) => selectedIds.includes(item.id));
  const activeFilterCount = [
    client !== 'All clients',
    Boolean(invoiceNumber),
    dateRange !== 'All dates',
    amountRange !== 'Any amount',
  ].filter(Boolean).length;

  const clearFilters = () => {
    setQuery('');
    setClient('All clients');
    setInvoiceNumber('');
    setDateRange('All dates');
    setAmountRange('Any amount');
  };
  const toggleSelected = (id: string) =>
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const selectAll = () =>
    setSelectedIds(
      filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id))
        ? selectedIds.filter((id) => !filtered.some((item) => item.id === id))
        : Array.from(new Set([...selectedIds, ...filtered.map((item) => item.id)])),
    );

  const createSelectedPdf = async () => {
    if (!sourcePdfBytes) throw new Error('No PDF loaded');
    const sourcePdf = await PDFDocument.load(sourcePdfBytes);
    const outputPdf = await PDFDocument.create();
    const pageIndexes = selected.map((item) => item.page - 1).sort((a, b) => a - b);
    const pages = await outputPdf.copyPages(sourcePdf, pageIndexes);
    pages.forEach((page) => outputPdf.addPage(page));
    const bytes = await outputPdf.save();
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  };
  const printSelected = async () => {
    if (!selected.length) return;
    announce('Preparing the selected invoice pages…');
    try {
      const blob = await createSelectedPdf();
      const pdfUrl = URL.createObjectURL(blob);
      const printWindow = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      announce(
        printWindow
          ? `${selected.length} selected invoice${selected.length > 1 ? 's are' : ' is'} open for printing`
          : 'Allow pop-ups to open the selected print set',
      );
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    } catch {
      announce('Could not prepare the selected invoices');
    }
  };
  const downloadSelected = async () => {
    if (!selected.length) return;
    announce('Preparing your selected PDF…');
    try {
      const blob = await createSelectedPdf();
      const pdfUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `selected-invoices-${selected.length}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
      announce(`Download started · ${selected.length} invoice${selected.length > 1 ? 's' : ''} selected`);
    } catch {
      announce('Could not create the selected PDF');
    }
  };

  return (
    <div className="paper-grain min-h-[100dvh] bg-[#f3efe6] text-[#28313b]">
      <div className="flex min-h-[100dvh]">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-[#202d38] px-5 py-6 text-[#e6e3d8] transition-transform duration-300 lg:static lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center gap-3 px-1">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e66a4c] text-[#fff8ed] shadow-[0_7px_18px_rgba(230,106,76,.25)]">
              <FileText size={20} strokeWidth={2.3} />
            </div>
            <div>
              <div className="font-display text-[16px] font-semibold leading-5 tracking-[-.02em]">Syed Moiz Dev</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[.16em] text-[#9ea9a7]">PDF Finder</div>
            </div>
          </div>
          <div className="my-9 h-px bg-[#ffffff14]" />
          <nav className="space-y-1" aria-label="Primary">
            <button onClick={() => setMobileNav(false)} className="flex w-full items-center gap-3 rounded-lg bg-[#ffffff0e] px-3 py-2.5 text-left text-sm font-semibold text-[#fff8ed]">
              <LayoutGrid size={17} />Invoice workspace
              <span className="ml-auto rounded-md bg-[#e66a4c] px-1.5 py-0.5 font-mono text-[10px]">{invoices.length}</span>
            </button>
            <button onClick={() => announce('You are already viewing the invoice workspace')} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-[#aeb7b4] transition-colors hover:bg-[#ffffff0b] hover:text-[#fff8ed]">
              <ListFilter size={17} />Recent searches
            </button>
          </nav>
          <div className="mt-auto rounded-xl border border-[#ffffff12] bg-[#ffffff08] p-4">
            <div className="mb-3 flex items-center gap-2 text-[#f1c37a]"><Sparkles size={15} /><span className="text-[11px] font-semibold uppercase tracking-[.13em]">Quick tip</span></div>
            <p className="text-xs leading-5 text-[#bac1bc]">Open a PDF first, search one client, then tick invoices to create a clean print set.</p>
            <p className="mt-3 font-mono text-[10px] text-[#84918e]">{pageCount ? `${pageCount} pages indexed · local file` : 'No PDF selected yet'}</p>
          </div>
          <div className="mt-6 flex items-center gap-2 border-t border-[#ffffff12] pt-4 text-xs text-[#899694]">
            <div className="h-7 w-7 rounded-full bg-[#d6a45f] p-1.5 text-center font-bold text-[#26333b]">SM</div>
            <div><div className="text-[#d7d9d0]">Syed Moiz Dev</div><div className="text-[10px]">Local workspace</div></div>
            <button onClick={() => announce('Choose a PDF, then filter clients from the list')} className="ml-auto rounded p-1 hover:bg-[#ffffff12]"><HelpCircle size={15} /></button>
          </div>
        </aside>
        {mobileNav && <button aria-label="Close navigation" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-[#15202a99] lg:hidden" />}

        <main className="min-w-0 flex-1">
          <header className="flex min-h-[76px] items-center justify-between gap-3 border-b border-[#dfd8cb] bg-[#f7f3ebcc] px-5 py-3 backdrop-blur-sm sm:px-8">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileNav(true)} className="rounded-lg p-2 hover:bg-[#e8e0d4] lg:hidden"><Menu size={20} /></button>
              <div><p className="font-mono text-[10px] uppercase tracking-[.17em] text-[#9b9488]">Syed Moiz Dev / PDF workspace</p><h1 className="font-display mt-0.5 text-xl font-semibold tracking-[-.025em] text-[#202d38] sm:text-2xl">Find an invoice</h1></div>
            </div>
            <div className="flex items-center gap-2">
              <input ref={fileInputRef} data-testid="input-pdf" type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileChange} />
              <button data-testid="button-upload-pdf" onClick={openFilePicker} className="flex items-center gap-2 rounded-lg bg-[#e66a4c] px-3 py-2 text-xs font-bold text-[#fff8ed] shadow-[0_5px_14px_rgba(230,106,76,.18)] transition-all hover:-translate-y-0.5 hover:bg-[#d95d41]"><Upload size={15} />Open PDF</button>
              <div className="hidden items-center gap-2 rounded-full border border-[#dcd4c7] bg-[#fdf9f1] px-3 py-1.5 text-[11px] text-[#6d746f] sm:flex"><span className={`h-2 w-2 rounded-full ${sourcePdfUrl ? 'bg-[#4c9c77]' : 'bg-[#c7a35d]'}`} />{sourcePdfUrl ? 'PDF loaded' : 'No PDF loaded'}</div>
              <div className="hidden h-8 w-8 rounded-full border border-[#d8cfc1] bg-[#e5d1b2] text-center pt-1.5 text-xs font-bold text-[#554436] sm:block">SM</div>
            </div>
          </header>

          <div className="mx-auto max-w-[1540px] px-4 py-5 sm:px-8 sm:py-7">
            <section className="animate-rise rounded-2xl border border-[#dfd5c7] bg-[#fbf8f1] p-4 shadow-[0_2px_12px_rgba(52,47,39,.04)] sm:p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
                <label className="block min-w-0 flex-1">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.13em] text-[#87877e]">Search by client / invoice</span>
                  <div className="relative"><Search className="absolute left-3.5 top-3.5 text-[#9d9b93]" size={18} /><input data-testid="input-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={invoices.length ? 'Try a client name or invoice number' : 'Upload a PDF first to search'} disabled={!invoices.length} className="h-11 w-full rounded-lg border border-[#dcd3c4] bg-[#fffdf8] pl-11 pr-10 text-sm text-[#28313b] shadow-inner shadow-[#4c42331a] placeholder:text-[#aaa79d] disabled:cursor-not-allowed disabled:opacity-60" />{query && <button aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-3 top-3 rounded-full p-0.5 text-[#99958b] hover:bg-[#eee6da]"><X size={15} /></button>}</div>
                </label>
                <label className="block w-full xl:w-[230px]"><span className="mb-2 block text-[11px] font-bold uppercase tracking-[.13em] text-[#87877e]">Client</span><div className="relative"><select data-testid="select-client" value={client} disabled={!invoices.length} onChange={(event) => setClient(event.target.value)} className="h-11 w-full appearance-none rounded-lg border border-[#dcd3c4] bg-[#fffdf8] px-3.5 pr-9 text-sm text-[#28313b] disabled:cursor-not-allowed disabled:opacity-60"><option>All clients</option>{clients.slice(1).map((item) => <option key={item}>{item}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-[#8d8a80]" size={16} /></div></label>
                <button onClick={() => setShowFilters((value) => !value)} className={`flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors ${showFilters || activeFilterCount ? 'border-[#e66a4c] bg-[#fff0e9] text-[#ba4e36]' : 'border-[#dcd3c4] bg-[#fffdf8] text-[#555e5c] hover:bg-[#f2eadf]'}`}><SlidersHorizontal size={16} />Filters{activeFilterCount > 0 && <span className="rounded-full bg-[#e66a4c] px-1.5 text-[10px] text-white">{activeFilterCount}</span>}</button>
                <button onClick={() => announce(`${filtered.length} matching invoice${filtered.length === 1 ? '' : 's'} found`)} disabled={!invoices.length} className="h-11 rounded-lg bg-[#e66a4c] px-6 text-sm font-bold text-[#fff8ed] shadow-[0_5px_14px_rgba(230,106,76,.22)] transition-all hover:-translate-y-0.5 hover:bg-[#d95d41] active:translate-y-0] disabled:cursor-not-allowed disabled:opacity-50">Search</button>
              </div>
              {showFilters && <div className="animate-fade mt-4 grid gap-3 border-t border-[#e4dbce] pt-4 sm:grid-cols-3"><label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-[#87877e]">Invoice number</span><input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="e.g. DI-00007849" className="h-10 w-full rounded-lg border border-[#dcd3c4] bg-[#fffdf8] px-3 text-sm" /></label><label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-[#87877e]">Invoice date</span><select value={dateRange} onChange={(event) => setDateRange(event.target.value)} className="h-10 w-full rounded-lg border border-[#dcd3c4] bg-[#fffdf8] px-3 text-sm"><option>All dates</option><option>Last 90 days</option><option>This month</option></select></label><label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-[#87877e]">Total amount</span><select value={amountRange} onChange={(event) => setAmountRange(event.target.value)} className="h-10 w-full rounded-lg border border-[#dcd3c4] bg-[#fffdf8] px-3 text-sm"><option>Any amount</option><option>Under PKR 300k</option><option>PKR 300k–700k</option><option>Over PKR 700k</option></select></label></div>}
            </section>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-display text-lg font-semibold text-[#28313b]">Matching invoices</h2><span className="rounded-full bg-[#e8dfd2] px-2 py-0.5 font-mono text-[11px] text-[#77736a]">{filtered.length} found</span></div><p className="mt-1 max-w-[560px] truncate text-xs text-[#8a8980]">{fileName ? `${fileName} · ${pageCount} pages` : 'Upload a PDF to start · client filtering happens inside your selected file'}</p></div><button onClick={clearFilters} className="flex items-center gap-1.5 self-start text-xs font-semibold text-[#b1503b] hover:text-[#8c3e2e] sm:self-auto"><RotateCcw size={14} />Clear filters</button></div>

            <div className="mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]">
              <section className="min-w-0 overflow-hidden rounded-2xl border border-[#dfd5c7] bg-[#fbf8f1] shadow-[0_2px_12px_rgba(52,47,39,.04)]">
                {selected.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eadfd2] bg-[#fff1e9] px-4 py-3 text-sm sm:px-5"><div className="flex items-center gap-2 font-semibold text-[#9f422e]"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e66a4c] text-xs text-white">{selected.length}</span>selected <span className="hidden font-normal text-[#b36858] sm:inline">· ready to print or download</span></div><div className="flex gap-2"><button onClick={printSelected} className="flex items-center gap-1.5 rounded-md border border-[#e5b7a7] bg-[#fffaf6] px-3 py-1.5 text-xs font-bold text-[#99422e] hover:bg-white"><Printer size={14} />Print</button><button onClick={downloadSelected} className="flex items-center gap-1.5 rounded-md bg-[#202d38] px-3 py-1.5 text-xs font-bold text-[#fff8ed] hover:bg-[#2d3d49]"><Download size={14} />Download</button></div></div>}
                {isLoading ? <div className="space-y-3 p-5"><div className="h-11 animate-pulse rounded-lg bg-[#eee7dc]" /><div className="h-16 animate-pulse rounded-lg bg-[#eee7dc]" /><div className="h-16 animate-pulse rounded-lg bg-[#eee7dc]" /></div> : loadError ? <EmptyState title="Could not read this PDF" text="Please choose a text-based PDF with invoice pages, then try again." actionLabel="Choose another PDF" onAction={openFilePicker} error /> : !invoices.length ? <EmptyState title="Open a PDF to begin" text="Aap pehle apni invoice PDF upload karein. App usi file ke clients aur invoices filter karega." actionLabel="Choose PDF" onAction={openFilePicker} /> : filtered.length === 0 ? <EmptyState title="No invoices found" text="No match mila. Try a shorter client name or remove one of the filters." actionLabel="Clear all filters" onAction={clearFilters} /> : <><div className="flex items-center justify-between border-b border-[#eadfd2] px-4 py-3 sm:px-5"><label className="flex items-center gap-2 text-xs font-semibold text-[#6e756f]"><input type="checkbox" checked={filtered.every((item) => selectedIds.includes(item.id))} onChange={selectAll} className="h-4 w-4 accent-[#e66a4c]" />Select all <span className="font-normal text-[#a09c92]">({filtered.length})</span></label><div className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#9e9b91] sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#4c9c77]" />Read from uploaded PDF</div></div><div className="divide-y divide-[#eee5d9]">{filtered.map((item) => <button key={item.id} onClick={() => { setActiveId(item.id); setMobileDetail(true); }} className={`group grid w-full grid-cols-[24px_minmax(140px,1.2fr)_minmax(95px,.8fr)_minmax(100px,.8fr)] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[#fff5eb] sm:grid-cols-[28px_minmax(175px,1.25fr)_minmax(120px,.8fr)_minmax(120px,.8fr)_minmax(90px,.55fr)] sm:px-5 ${active?.id === item.id ? 'bg-[#fff4eb]' : ''}`}><input onClick={(event) => event.stopPropagation()} onChange={() => toggleSelected(item.id)} checked={selectedIds.includes(item.id)} type="checkbox" className="h-4 w-4 accent-[#e66a4c]" /><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold text-[#a24734]">{item.number}</span>{active?.id === item.id && <span className="hidden rounded bg-[#f9dfd1] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#b25038] sm:inline">Open</span>}</div><div className="mt-1 truncate text-xs text-[#8a8980]">{item.client}</div></div><div className="hidden text-xs text-[#6f766f] sm:block">{formatDate(item.date)}<div className="mt-1 font-mono text-[10px] text-[#a8a399]">PDF p.{item.page}</div></div><div className="text-right text-xs font-semibold text-[#39444a] sm:text-left">{formatPKR(item.amount)}<div className="mt-1 text-[10px] font-normal text-[#99968d]">incl. sales tax</div></div><div className="hidden justify-end sm:flex"><StatusPill status={item.status} /></div></button>)}</div></>}
              </section>
              <InvoiceDetail invoice={active} selectedIds={selectedIds} onSelect={toggleSelected} onPrint={printSelected} sourcePdfUrl={sourcePdfUrl} pageCount={pageCount} mobileDetail={mobileDetail} onClose={() => setMobileDetail(false)} />
            </div>
          </div>
        </main>
      </div>
      {notice && <div className="animate-rise fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#202d38] px-4 py-3 text-sm font-semibold text-[#fff8ed] shadow-[0_10px_30px_rgba(32,45,56,.22)]"><Check size={16} className="text-[#91c69f]" />{notice}</div>}
    </div>
  );
}

function EmptyState({ title, text, actionLabel, onAction, error = false }: { title: string; text: string; actionLabel: string; onAction: () => void; error?: boolean }) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
      <div className={`mb-4 rounded-full p-4 ${error ? 'bg-[#f7dfdb] text-[#a1372e]' : 'bg-[#e9e2d6] text-[#7b817c]'}`}>{error ? <CircleAlert size={24} /> : <Upload size={24} />}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-5 text-[#89887f]">{text}</p>
      <button onClick={onAction} className="mt-4 rounded-lg bg-[#202d38] px-4 py-2 text-xs font-bold text-[#fff8ed]">{actionLabel}</button>
    </div>
  );
}

function InvoiceDetail({ invoice, selectedIds, onSelect, onPrint, sourcePdfUrl, pageCount, mobileDetail, onClose }: { invoice?: Invoice; selectedIds: string[]; onSelect: (id: string) => void; onPrint: () => void; sourcePdfUrl: string; pageCount: number; mobileDetail: boolean; onClose: () => void }) {
  if (!invoice) return <section className="hidden min-h-[300px] xl:block rounded-2xl border border-dashed border-[#d8cfc1] bg-[#f7f1e7] p-8 text-center text-sm text-[#8a8980]">Invoice details will appear here.</section>;
  const isSelected = selectedIds.includes(invoice.id);
  return (
    <section className={`${mobileDetail ? 'fixed inset-0 z-40 flex' : 'hidden'} flex-col overflow-y-auto border-[#dfd5c7] bg-[#f8f4ec] xl:sticky xl:top-5 xl:flex xl:max-h-[calc(100dvh-112px)] xl:rounded-2xl xl:border xl:shadow-[0_2px_12px_rgba(52,47,39,.04)]`}>
      <div className="flex items-start justify-between border-b border-[#e1d8cb] px-5 py-4"><div><div className="flex items-center gap-2"><span className="font-mono text-[11px] uppercase tracking-[.12em] text-[#a24734]">Invoice detail</span><span className="rounded bg-[#e8dfd2] px-1.5 py-0.5 font-mono text-[10px] text-[#8b857b]">p.{invoice.page} / {pageCount}</span></div><h2 className="font-display mt-1 text-xl font-semibold text-[#28313b]">{invoice.number}</h2></div><button onClick={onClose} className="rounded-lg p-1.5 text-[#88867d] hover:bg-[#e9e1d6] xl:hidden"><X size={19} /></button></div>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-5 rounded-xl border border-[#ded2c3] bg-[#fffdf8] p-4 shadow-[0_5px_18px_rgba(80,64,44,.06)]"><div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#99958b]">Billed to</p><h3 className="mt-1 font-display text-lg font-semibold">{invoice.client}</h3><p className="font-mono text-[10px] text-[#9b978d]">{invoice.clientCode} · uploaded PDF</p></div><StatusPill status={invoice.status} /></div><div className="grid grid-cols-2 gap-3 border-t border-[#eee5d9] pt-3 text-xs"><div><p className="text-[#99958b]">Invoice date</p><p className="mt-1 font-semibold text-[#4b5556]">{formatDate(invoice.date)}</p></div><div><p className="text-[#99958b]">Sales tax</p><p className="mt-1 font-semibold text-[#4b5556]">{formatPKR(invoice.tax)}</p></div></div></div>
        <div className="mb-5"><div className="mb-2 flex items-center justify-between"><h3 className="text-[11px] font-bold uppercase tracking-[.14em] text-[#8b8a81]">Invoice preview</h3>{sourcePdfUrl && <button onClick={() => window.open(`${sourcePdfUrl}#page=${invoice.page}`, '_blank', 'noopener,noreferrer')} className="flex items-center gap-1 font-mono text-[10px] font-semibold text-[#a24734] hover:text-[#7f3427]"><FileText size={12} />Open source PDF</button>}</div><div className="relative overflow-hidden rounded-xl border border-[#d9cdbc] bg-[#e8e1d5] p-3"><div className="min-h-[240px] rounded-[3px] border border-[#d9d1c5] bg-[#fffefa] p-4 shadow-[0_3px_8px_rgba(53,44,34,.08)]"><div className="flex items-start justify-between border-b-2 border-[#28313b] pb-3"><div><div className="font-display text-base font-bold tracking-tight text-[#28313b]">PDF INVOICE</div><div className="mt-1 text-[7px] uppercase tracking-[.15em] text-[#8f918c]">Uploaded source page</div></div><div className="text-right font-mono text-[8px] text-[#6f746f]"><div>{invoice.number}</div><div>{formatDate(invoice.date)}</div></div></div><div className="mt-4 flex justify-between text-[8px]"><div><span className="text-[#99958b]">Customer</span><div className="mt-1 font-bold text-[#39444a]">{invoice.client}</div></div><div className="text-right"><span className="text-[#99958b]">Page</span><div className="mt-1 font-bold">{invoice.page} / {pageCount}</div></div></div><div className="mt-5 overflow-hidden rounded border border-[#e3ddd3]"><div className="grid grid-cols-[1fr_35px_53px] bg-[#f0ece4] p-1.5 text-[7px] font-bold text-[#71746e]"><span>Description</span><span>Qty</span><span className="text-right">Amount</span></div>{invoice.items.map((row) => <div key={row.description} className="grid grid-cols-[1fr_35px_53px] border-t border-[#eee9e1] p-1.5 text-[7px] text-[#626966]"><span>{row.description}</span><span>{row.qty}</span><span className="text-right">{new Intl.NumberFormat('en-PK').format(row.qty * row.rate)}</span></div>)}</div><div className="mt-4 flex justify-end"><div className="w-[120px] border-t border-[#28313b] pt-1.5 text-right text-[8px] font-bold text-[#28313b]">{formatPKR(invoice.amount)}</div></div><div className="mt-7 flex justify-between border-t border-[#eee9e1] pt-2 text-[6px] text-[#aaa49a]"><span>Computer generated document</span><span>Original PDF page {invoice.page}</span></div></div><div className="pointer-events-none absolute bottom-4 right-5 rotate-[-12deg] border-2 border-[#d8755e55] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-[#d8755e88]">Preview</div></div></div>
        <div><h3 className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-[#8b8a81]">Line items</h3><div className="divide-y divide-[#e8dfd3] rounded-xl border border-[#e1d8cc] bg-[#fbf8f1] px-3">{invoice.items.map((item) => <div key={item.description} className="flex items-start justify-between gap-3 py-3 text-xs"><div><p className="font-medium text-[#4c5557]">{item.description}</p><p className="mt-1 text-[10px] text-[#9c978d]">{item.qty.toLocaleString()} units · {formatPKR(item.rate)} each</p></div><span className="font-mono text-[10px] text-[#707771]">{formatPKR(item.qty * item.rate)}</span></div>)}</div></div>
      </div>
      <div className="flex gap-2 border-t border-[#e1d8cb] bg-[#f4eee5] p-4"><button onClick={() => onSelect(invoice.id)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-colors ${isSelected ? 'border-[#c6a093] bg-[#fff0e9] text-[#a44732]' : 'border-[#d8cfc1] bg-[#fffdf8] text-[#515c5c] hover:bg-white'}`}>{isSelected ? <Check size={15} /> : <span className="h-3.5 w-3.5 rounded border border-current" />}{isSelected ? 'Selected' : 'Select invoice'}</button><button onClick={onPrint} disabled={!isSelected} className="flex items-center justify-center gap-2 rounded-lg bg-[#202d38] px-4 py-2.5 text-xs font-bold text-[#fff8ed] disabled:cursor-not-allowed disabled:opacity-40"><Printer size={15} />Print set</button></div>
    </section>
  );
}

export default App;