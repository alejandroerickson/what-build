import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../lib/api.ts";
import { useMe, type ProductsResponse } from "../lib/session.tsx";
import { Button, Callout, Dialog, ErrorCallout, SelectField, TextArea, TextField } from "../ui/index.tsx";

/**
 * New product, opened in place from the overview or the product switch, so cancelling leaves the
 * person where they were. The team is asked only when they can create in more than one.
 */
export function CreateProductDialog({ onClose, tenants }: { onClose: () => void; tenants: ProductsResponse["tenants"] }) {
  const qc = useQueryClient();
  const me = useMe();
  const navigate = useNavigate();
  const orgs = tenants.filter((t) => t.teams.some((tm) => tm.your_role === "admin")).length;
  const teams = tenants.flatMap((t) =>
    t.teams.filter((tm) => tm.your_role === "admin").map((tm) => ({ key: `${t.slug}/${tm.slug}`, label: orgs > 1 ? `${t.name} · ${tm.name}` : tm.name })),
  );
  const [team, setTeam] = useState(teams[0]?.key ?? "");
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const create = useMutation({
    mutationFn: () => api<{ path: string }>("POST", `/api/v1/teams/${team}/products`, { name: name.trim(), concept }),
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
      description={teams.length ? "Each product is one discovery, with its own outcomes, sources, insights and Story." : undefined}
      footer={
        teams.length ? (
          <>
            <Button onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={create.isPending} busyLabel="Creating…" disabled={!team || !name.trim()} onClick={() => create.mutate()}>
              Create product
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {teams.length ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (team && name.trim()) create.mutate();
          }}
        >
          {teams.length > 1 ? (
            <SelectField label="Team" value={team} onChange={(e) => setTeam(e.target.value)}>
              {teams.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </SelectField>
          ) : null}
          <TextField label="Name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          <TextArea label="Product concept" optional rows={3} maxLength={2000} value={concept} onChange={(e) => setConcept(e.target.value)} hint="Who it’s for, the problem they have, and how the product solves it. Shown at the top of Idea." />
          {create.isError ? <ErrorCallout inset error={create.error} /> : null}
        </form>
      ) : (
        <Callout inset tone="info">
          Creating a product needs an admin role on a team. Ask a team admin
          {me.data?.tenant_allowance.remaining !== 0 ? (
            <>
              , or <Link to="/welcome">set up your own organization</Link>
            </>
          ) : null}
          .
        </Callout>
      )}
    </Dialog>
  );
}
