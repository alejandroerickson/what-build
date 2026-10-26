import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { plural } from "../lib/format.ts";
import { forgetPersonalState } from "../lib/local-state.ts";
import { useHideExample, useMe, useProducts } from "../lib/session.tsx";
import { usePageTitle } from "../shell/slots.tsx";
import { DeleteAccount } from "./delete-account.tsx";
import { Button, ChoiceRow, Dialog, ErrorCallout, FormGrid, Sheet, SheetBody, SheetHeader, TextField, useToast } from "../ui/index.tsx";
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
    <>
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
              hint="Shown beside what you and your agents write."
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
            />
            <TextField label="Email" value={me.data?.email ?? ""} readOnly />
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
      <ExampleInPanel />
      <SignOutEverywhere />
      <DeleteAccount />
      <p className="agents-foot">
        <Link to="/cookies">Cookies and analytics</Link> · <Link to="/privacy">Privacy</Link>
      </p>
    </>
  );
}

/** For a guest of the example organization: whether the panel shows it. The overview always does. */
function ExampleInPanel() {
  const me = useMe();
  const example = useProducts().data?.tenants.find((t) => t.example && t.your_role === "guest");
  const hide = useHideExample();
  if (!example || !me.data) return null;
  return (
    <Sheet className="account-sheet" labelledBy="example-title">
      <SheetHeader id="example-title" title="Example organization" />
      <SheetBody>
        <ChoiceRow
          label="Show the example organization in the panel"
          hint="It stays on the overview either way."
          checked={!me.data.hide_example}
          disabled={hide.isPending}
          onChange={(e) => hide.mutate(!e.target.checked)}
        />
        {hide.isError ? <ErrorCallout inset error={hide.error} /> : null}
      </SheetBody>
    </Sheet>
  );
}

/**
 * Sign out everywhere: every browser this person is signed in on, and every agent they connected,
 * at once. This browser signs out too unless they keep it, since it may be the one at risk.
 */
function SignOutEverywhere() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const end = useMutation({
    mutationFn: (keep: boolean) => api<{ sessions: number; connections: number; kept_this_session: boolean }>("POST", "/api/v1/me/sign-out-everywhere", { keep_this_session: keep }),
    onSuccess: (r) => {
      if (!r.kept_this_session) {
        forgetPersonalState();
        qc.clear();
        window.location.assign("/signin");
        return;
      }
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["agents"] });
      toast(`Signed out of every other browser${r.connections ? `, and disconnected ${plural(r.connections, "agent")}` : ""}.`);
    },
  });
  const close = () => {
    setOpen(false);
    end.reset();
  };
  return (
    <Sheet className="account-sheet" labelledBy="everywhere-title">
      <SheetHeader id="everywhere-title" title="Sign out everywhere" />
      <SheetBody className="account-everywhere">
        <p className="muted">Sign out of every browser and disconnect every agent you connected, at once. Use it if a device is lost, or you aren&rsquo;t sure what you allowed.</p>
        <div>
          <Button onClick={() => setOpen(true)}>Sign out everywhere…</Button>
        </div>
      </SheetBody>
      {open ? (
        <Dialog
          open
          onClose={close}
          dismissable={!end.isPending}
          title="Sign out everywhere?"
          description="Every agent you connected is disconnected, and every browser signed in as you is signed out: this one too, unless you choose everywhere else. You connect each agent again to use it."
          footer={
            <>
              <Button onClick={close} disabled={end.isPending}>
                Cancel
              </Button>
              <Button onClick={() => end.mutate(true)} disabled={end.isPending} busy={end.isPending && end.variables === true} busyLabel="Signing out…">
                Everywhere else
              </Button>
              <Button variant="danger" onClick={() => end.mutate(false)} disabled={end.isPending} busy={end.isPending && end.variables === false} busyLabel="Signing out…">
                Sign out everywhere
              </Button>
            </>
          }
        >
          {end.isError ? <ErrorCallout inset error={end.error} /> : null}
        </Dialog>
      ) : null}
    </Sheet>
  );
}
