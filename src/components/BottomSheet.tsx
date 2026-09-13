'use client';

/**
 * A sheet: the one way the app asks a small question or offers a short
 * menu without leaving the screen. On a phone it rises from the bottom,
 * within reach of the thumb; on a wide screen it sits in the middle.
 *
 * Built on the native <dialog>, so the page behind it is inert, Esc works,
 * and focus goes back to whatever opened it when it closes. Rules, from
 * docs/MOBILE.md: one sheet at a time (a second open is a programming
 * error, and says so in development); it closes on Back and on any route
 * change; its title is focused first so the first thing announced is what
 * the sheet is for; long content scrolls inside it under a fixed header.
 * Nothing here is a form with more than one control.
 */

import { useEffect, useId, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './Icons';

let openSheets = 0;

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  dismissible = true,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** False keeps the sheet up until a button inside closes it. */
  dismissible?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  // The latest onClose, so the effects below never hold a stale one.
  const close = useRef(onClose);
  close.current = onClose;

  // Open and close the native dialog with the prop. The cleanup runs when
  // `open` turns false or the sheet unmounts, so closing is one path.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !open) return;

    if (openSheets > 0) {
      // A sheet over a sheet is exactly what the phone must never show.
      if (process.env.NODE_ENV !== 'production') {
        throw new Error('Wintora: one sheet at a time. Close the open sheet before opening another.');
      }
      console.warn('Wintora: a second sheet was opened over the first and was ignored.');
      close.current();
      return;
    }
    openSheets += 1;

    // iOS Safari scrolls the page behind a modal dialog; pin the body and
    // put the scroll position back afterwards.
    const body = document.body;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';

    if (!dialog.open) dialog.showModal();
    titleRef.current?.focus();

    const onPop = (): void => close.current();
    window.addEventListener('popstate', onPop);

    return () => {
      openSheets -= 1;
      window.removeEventListener('popstate', onPop);
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
      if (dialog.open) dialog.close();
    };
  }, [open]);

  // A route change under an open sheet closes it: Back never leaves a
  // sheet over a new page.
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      if (open) close.current();
    }
  }, [pathname, open]);

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby={titleId}
      aria-describedby={description !== undefined ? descriptionId : undefined}
      onCancel={(event) => {
        // Esc. Keep React in charge of the open state.
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        // Closed by the browser itself (some Esc paths); tell React.
        if (open) onClose();
      }}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === dialogRef.current;
      }}
      onClick={(event) => {
        // A tap that began and ended on the backdrop, not a drag off the panel.
        if (dismissible && pressedOnBackdrop.current && event.target === dialogRef.current) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      <div className="sheet__panel">
        <div className="sheet__handle" aria-hidden />
        <div className="sheet__head">
          <h2 id={titleId} className="sheet__title" tabIndex={-1} ref={titleRef}>
            {title}
          </h2>
          <button type="button" className="btn btn--quiet btn--icon" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {description !== undefined ? (
          <p id={descriptionId} className="sheet__desc">
            {description}
          </p>
        ) : null}
        <div className="sheet__body">{children}</div>
        {footer !== undefined ? <div className="sheet__foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}
