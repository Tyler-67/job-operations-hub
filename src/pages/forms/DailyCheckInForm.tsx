import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

type PartsSource = "none" | "field_purchase" | "supply_house";
type SupplyHouseAction = "place_order" | "already_ordered";
type PhotoKind = "receipt" | "parts" | "job_site";

interface SupplyHouse {
  id: string;
  name: string;
}

interface TokenPayload {
  token?: string;
  payload?: Record<string, unknown>;
  job_id?: string;
  contact_id?: string;
  [key: string]: unknown;
}

interface Branding {
  companyName: string;
  primaryColor: string;
  logoUrl: string | null;
  address: string | null;
  phaseLabel: string | null;
}

function readBranding(payload: TokenPayload): Branding {
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const brand = (inner.branding ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    companyName: str(brand.company_name) ?? "Daily Check-In",
    primaryColor: str(brand.primary_color) ?? "#0f172a",
    logoUrl: str(brand.logo_url),
    address: str(inner.address),
    phaseLabel: str(inner.state_label),
  };
}

// Supply houses + the company default are embedded in the token payload (the same
// place branding comes from), so the anon form never has to query them itself.
function readSupplyHouses(payload: TokenPayload): { houses: SupplyHouse[]; defaultId: string | null } {
  const inner = (payload.payload ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(inner.supply_houses) ? inner.supply_houses : [];
  const houses: SupplyHouse[] = [];
  for (const item of raw) {
    const obj = (item ?? {}) as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : "";
    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : id;
    if (id) houses.push({ id, name });
  }
  const defaultRaw = typeof inner.default_supply_house_id === "string" ? inner.default_supply_house_id : null;
  const defaultId = defaultRaw && houses.some((h) => h.id === defaultRaw) ? defaultRaw : (houses[0]?.id ?? null);
  return { houses, defaultId };
}

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    apikey: PUBLISHABLE_KEY,
    authorization: `Bearer ${PUBLISHABLE_KEY}`,
  };
}

// Asks the job-photos function for a one-object signed upload URL, PUTs the file to
// Storage, and returns the stored path to submit with the check-in.
async function uploadPhoto(token: string, kind: PhotoKind, file: File): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/job-photos`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action: "upload_url", token, kind, content_type: file.type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "upload_failed");
  const put = await fetch(data.signed_url, {
    method: "PUT",
    headers: { "content-type": file.type },
    body: file,
  });
  if (!put.ok) throw new Error("storage_upload_failed");
  return data.path as string;
}

export default function DailyCheckInForm({ payload }: { payload: TokenPayload }) {
  const brand = useMemo(() => readBranding(payload), [payload]);
  const { houses: supplyHouses, defaultId: defaultSupplyHouseId } = useMemo(
    () => readSupplyHouses(payload),
    [payload],
  );
  const token = payload.token ?? "";

  const [hours, setHours] = useState("");
  const [progress, setProgress] = useState("");
  const [partsSource, setPartsSource] = useState<PartsSource>("none");
  const [fieldAmount, setFieldAmount] = useState("");
  const [fieldVendor, setFieldVendor] = useState("");
  const [partsList, setPartsList] = useState("");
  const [supplyAction, setSupplyAction] = useState<SupplyHouseAction>("place_order");
  const [supplyHouseId, setSupplyHouseId] = useState<string>(defaultSupplyHouseId ?? "");
  const [issues, setIssues] = useState("");
  const [inspection, setInspection] = useState(false);
  const [inspectionConfirmOpen, setInspectionConfirmOpen] = useState(false);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [partsFile, setPartsFile] = useState<File | null>(null);
  const [siteFiles, setSiteFiles] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ inspectionRequested: boolean } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Upload photos first, then submit the log with their storage paths.
      const receiptPath = receiptFile ? await uploadPhoto(token, "receipt", receiptFile) : null;
      const partsPath = partsFile ? await uploadPhoto(token, "parts", partsFile) : null;
      const sitePaths: string[] = [];
      for (const file of siteFiles) sitePaths.push(await uploadPhoto(token, "job_site", file));

      const res = await fetch(`${SUPABASE_URL}/functions/v1/forms-daily-check-in`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          token,
          hours_worked: hours,
          state_progress_pct: progress,
          parts_source: partsSource,
          parts_list: partsSource === "supply_house" ? partsList : null,
          supply_house_action: partsSource === "supply_house" ? supplyAction : null,
          supply_house_id: partsSource === "supply_house" ? supplyHouseId || null : null,
          field_purchase_amount: partsSource === "field_purchase" ? fieldAmount : null,
          field_purchase_vendor: partsSource === "field_purchase" ? fieldVendor : null,
          receipt_photo_url: receiptPath,
          parts_photo_url: partsPath,
          job_site_photo_urls: sitePaths,
          issues,
          inspection_requested: inspection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "submit_failed");
      setDone({ inspectionRequested: Boolean(data.state_changed) || inspection });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
        <p className="font-semibold">Check-in submitted.</p>
        <p className="mt-1 text-sm">
          Thanks{brand.companyName !== "Daily Check-In" ? ` — ${brand.companyName} has it` : ""}.
          {done.inspectionRequested ? " The office has been notified that this phase is ready for inspection." : ""}
        </p>
      </div>
    );
  }

  const accent = { backgroundColor: brand.primaryColor } as const;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <header className="flex items-center gap-3 border-b pb-4">
        {brand.logoUrl ? (
          <img src={brand.logoUrl} alt={brand.companyName} className="h-10 w-10 rounded object-contain" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded text-sm font-semibold text-white" style={accent}>
            {brand.companyName.slice(0, 1)}
          </span>
        )}
        <div>
          <p className="text-sm font-semibold leading-tight">{brand.companyName}</p>
          {brand.address && <p className="text-xs text-muted-foreground">{brand.address}</p>}
          {brand.phaseLabel && <p className="text-xs text-muted-foreground">Phase: {brand.phaseLabel}</p>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="hours">Hours worked</Label>
          <Input id="hours" type="number" inputMode="decimal" min="0" step="0.25" value={hours}
            onChange={(e) => setHours(e.target.value)} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="progress">Phase progress %</Label>
          <Input id="progress" type="number" inputMode="numeric" min="0" max="100" value={progress}
            onChange={(e) => setProgress(e.target.value)} placeholder="0" />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Parts</legend>
        {([
          ["none", "No parts today"],
          ["field_purchase", "I bought parts (field purchase)"],
          ["supply_house", "Ordered from supply house"],
        ] as const).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="parts_source" value={value} checked={partsSource === value}
              onChange={() => setPartsSource(value)} />
            {label}
          </label>
        ))}
      </fieldset>

      {partsSource === "field_purchase" && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="amount">Amount</Label>
              <Input id="amount" type="number" inputMode="decimal" min="0" step="0.01" value={fieldAmount}
                onChange={(e) => setFieldAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vendor">Vendor</Label>
              <Input id="vendor" value={fieldVendor} onChange={(e) => setFieldVendor(e.target.value)} placeholder="Home Depot" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="receipt">Receipt photo</Label>
            <Input id="receipt" type="file" accept="image/*,application/pdf"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="parts-photo">Parts photo</Label>
            <Input id="parts-photo" type="file" accept="image/*"
              onChange={(e) => setPartsFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
      )}

      {partsSource === "supply_house" && (
        <div className="space-y-3 rounded-md border p-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Supply house</legend>
            {([
              ["place_order", "Place order with supply house"],
              ["already_ordered", "I've already ordered from supply house"],
            ] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="supply_house_action" value={value} checked={supplyAction === value}
                  onChange={() => setSupplyAction(value)} />
                {label}
              </label>
            ))}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="supply-house">Which supply house?</Label>
            {supplyHouses.length > 0 ? (
              <Select value={supplyHouseId} onValueChange={setSupplyHouseId}>
                <SelectTrigger id="supply-house">
                  <SelectValue placeholder="Select a supply house" />
                </SelectTrigger>
                <SelectContent>
                  {supplyHouses.map((h) => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">No supply houses configured.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="parts-list">What did you order?</Label>
            <Textarea id="parts-list" value={partsList} onChange={(e) => setPartsList(e.target.value)}
              placeholder={supplyAction === "place_order"
                ? "List the parts to order — the supply house gets this list"
                : "List the parts the office should value the PO for"} />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="site-photos">Job site photos</Label>
        <Input id="site-photos" type="file" accept="image/*" multiple
          onChange={(e) => setSiteFiles(Array.from(e.target.files ?? []))} />
        {siteFiles.length > 0 && (
          <p className="text-xs text-muted-foreground">{siteFiles.length} photo(s) selected</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="issues">Issues or notes</Label>
        <Textarea id="issues" value={issues} onChange={(e) => setIssues(e.target.value)}
          placeholder="Anything the office should know" />
      </div>

      <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
        <Checkbox
          checked={inspection}
          onCheckedChange={(v) => {
            // Checking it notifies the office — gate behind a confirmation so an
            // accidental tap can't trigger an inspection. Unchecking is harmless.
            if (v === true) setInspectionConfirmOpen(true);
            else setInspection(false);
          }}
        />
        Mark this phase ready for inspection
      </label>

      <AlertDialog open={inspectionConfirmOpen} onOpenChange={setInspectionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this phase ready for inspection?</AlertDialogTitle>
            <AlertDialogDescription>
              This notifies the office to schedule an inspection
              {brand.phaseLabel ? ` for the ${brand.phaseLabel} phase` : ""}. Only confirm if the
              work is genuinely ready.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setInspection(false)}>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => setInspection(true)}>Yes, request inspection</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      )}

      <Button type="submit" disabled={submitting} className="w-full text-white" style={accent}>
        {submitting ? "Submitting..." : "Submit check-in"}
      </Button>
    </form>
  );
}
