import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { useOrganizationLimits } from "../lib/limits.ts";
import { mayCreateProducts, useMe, type ProductsResponse } from "../lib/session.tsx";
import { Button, Callout, Dialog, ErrorCallout, SelectField, TextArea, TextField, tooLong } from "../ui/index.tsx";

/** The limits the server sets on a product. */
const NAME_MAX = 100;
const CONCEPT_MAX = 8000;

/**
 * New product, opened in place from the overview or the product switch, so cancelling leaves the
 * person where they were. Its organization's owners, admins and product creators create one; the
 * organization is asked only when they can create in more than one, and opening it from an
 * organization's own list (`tenant`) chooses that one. When the organization already holds all the
 * products its plan allows, it says so before anything is typed.
 */
export function CreateProductDialog({ onClose, tenants, tenant }: { onClose: () => void; tenants: ProductsResponse["tenants"]; tenant?: string }) {
  const qc = useQueryClient();
  const me = useMe();
  const navigate = useNavigate();
  const orgs = tenants.filter((t) => mayCreateProducts(t)).map((t) => ({ key: t.slug, label: t.name }));
  const [org, setOrg] = useState(orgs.find((o) => o.key === tenant)?.key ?? orgs[0]?.key ?? "");
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const limits = useOrganizationLimits(org, Boolean(org));
  const cap = limits.data?.limits.find((l) => l.key === "products_max")?.value;
  const held = limits.data?.holds?.products ?? 0;
  const full = typeof cap === "number" && held >= cap;
  const ready = Boolean(org) && Boolean(name.trim()) && !full && !tooLong(name, NAME_MAX) && !tooLong(concept, CONCEPT_MAX);
  const create = useMutation({
    mutationFn: () => api<{ path: string }>("POST", `/api/v1/tenants/${org}/products`, { name: name.trim(), concept }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      navigate(`/t/${p.path}/idea`);
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!create.isPending}
      title="New product"
      footer={
        orgs.length ? (
          <>
            <Button onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!ready} onClick={() => create.mutate()}>
              Create product
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {orgs.length ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) create.mutate();
          }}
        >
          {orgs.length > 1 ? (
            <SelectField label="Organization" value={org} onChange={(e) => setOrg(e.target.value)}>
              {orgs.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </SelectField>
          ) : null}
          {full && limits.data ? (
            <Callout inset tone="attention" title={`${limits.data.organization.name} holds all the products its plan allows`}>
              Its {limits.data.plan_name} plan allows {cap === 1 ? "1 product" : `${cap} products`}, archived ones included, and it has {held}. An admin of a product no longer needed
              can delete it in its Settings to make room, or ask whoever runs this WhatBuild to move the organization to a larger plan.
            </Callout>
          ) : null}
          <TextField label="Name" required maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea label="Product concept" optional rows={3} maxLength={CONCEPT_MAX} value={concept} onChange={(e) => setConcept(e.target.value)} hint="Who it’s for, their problem, and how the product solves it." />
          {create.isError ? <ErrorCallout inset error={create.error} /> : null}
        </form>
      ) : (
        <Callout inset tone="info">
          Creating a product needs a product creator, admin or owner of its organization. Ask one of its owners or admins to make you a product creator
          {me.data?.tenant_allowance.remaining !== 0 ? (
            <>
              , or <Link to="/welcome">start your own organization</Link>
            </>
          ) : null}
          .
        </Callout>
      )}
    </Dialog>
  );
}
