import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { Button, ErrorCallout, FormGrid, Sheet, SheetHeader, TextField, useToast } from "../ui/index.tsx";
import "../styles/screens/account.css";

/** `/settings`: the person's own settings, reached from the account menu. */
export function SettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  usePageTitle("Settings");
  const [name, setName] = useState(me.data?.display_name ?? "");
  useEffect(() => {
    if (me.data && !name) setName(me.data.display_name);
    // Fill once when the account arrives; never overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);
  const save = useMutation({
    mutationFn: () => api("PATCH", "/api/v1/me", { display_name: name.trim() }),
    onSuccess: () => {
      toast("Saved.");
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const dirty = Boolean(me.data) && name.trim() !== me.data?.display_name;
  return (
    <Sheet className="account-sheet" labelledBy="account-title">
      <SheetHeader level={1} id="account-title" title="Settings" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && name.trim()) save.mutate();
        }}
      >
        <FormGrid className="account-form">
          <TextField
            label="Display name"
            hint="Shown beside everything you write, and everything your agents write."
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
          />
          <TextField label="Email" value={me.data?.email ?? ""} readOnly hint="You sign in with this address." />
        </FormGrid>
        {save.isError ? (
          <div className="account-note">
            <ErrorCallout inset error={save.error} />
          </div>
        ) : null}
        <div className="account-actions">
          <Button type="submit" variant="primary" busy={save.isPending} busyLabel="Saving…" disabled={!dirty || !name.trim()}>
            Save changes
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
