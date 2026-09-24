/**
 * The dashboard header, wired to the active context.
 *
 * Every shell's home screen uses this rather than `AppHeader` directly, so the
 * switcher is present in exactly the places it should be and absent where it
 * should not — a guard's header has no caret because `contexts.length` is not
 * what decides it, the role is.
 */
import React, { useState } from 'react';
import { AppHeader } from '@/components/Screen';
import { ContextSwitcher } from '@/components/ContextSwitcher';
import { ROLE_LABEL } from '@/lib/rbac';
import { useAuth } from '@/lib/auth';
import { greeting } from '@/lib/datetime';

export function ShellHeader({
  meta,
  icon,
  badgeCount,
  onBell,
}: {
  meta?: string;
  icon?: React.ComponentProps<typeof AppHeader>['icon'];
  badgeCount?: number;
  onBell?: () => void;
}) {
  const { context, contexts } = useAuth();
  const [switching, setSwitching] = useState(false);

  if (!context) return null;

  /* A guard is locked to one shell for the shift (§4.3), and someone who
     genuinely holds only one context has nothing to switch *to* — in both
     cases the caret would be a control that does nothing. */
  const canSwitch = context.type !== 'GATE' && contexts.length > 1;

  return (
    <>
      <AppHeader
        greeting={greeting()}
        title={context.label}
        /* A household acts for a door with a number on it, so its place is set
           in a door plate. A gate and a society office are not doors. */
        plate={context.type === 'UNIT'}
        role={ROLE_LABEL[context.role]}
        meta={meta}
        icon={icon}
        onSwitch={canSwitch ? () => setSwitching(true) : undefined}
        badgeCount={badgeCount}
        onBell={onBell}
      />
      <ContextSwitcher visible={switching} onClose={() => setSwitching(false)} />
    </>
  );
}
