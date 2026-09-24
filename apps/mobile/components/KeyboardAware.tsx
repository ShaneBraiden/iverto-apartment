/**
 * Keyboard behaviour, in one place.
 *
 * Two things have to be true on every screen that holds a text field: the
 * field the cursor is in must be visible above the keyboard, and a tap on a
 * button must land the first time rather than only dismissing the keyboard.
 * Neither comes for free, and the platforms get there differently:
 *
 *   iOS      `automaticallyAdjustKeyboardInsets` grows the scroll view's own
 *            bottom inset by the keyboard height. No `KeyboardAvoidingView`,
 *            which would add the same offset a second time.
 *   Android  nothing, as of Android 15. Up to Android 14 the window itself
 *            resized (`softwareKeyboardLayoutMode: "resize"` in app.json,
 *            `adjustResize` in the manifest) and the scroll view came back
 *            shorter. An app that draws edge-to-edge — which every app
 *            targeting Android 16 does, with no opt-out — gets `adjustResize`
 *            ignored: the window keeps its full height and the keyboard is
 *            drawn on top of it.
 *
 * So on top of the platform mechanism this module measures: when the keyboard
 * opens, or the cursor moves to another field, it works out how far the field
 * sits below the bottom of what is still on screen and scrolls exactly that
 * far. The measurement is a no-op when the field is already visible, which is
 * what makes it safe to run on both platforms.
 *
 * Nothing below asks which Android version it is on. The keyboard's top edge
 * (`endCoordinates.screenY`) and the scroll frame's own bottom are both
 * measured, and the viewport ends at whichever is higher. On Android 14 the
 * window shrank, so the frame's bottom is already above the keyboard and wins;
 * on Android 15+ it did not, so the keyboard's top edge wins. One expression,
 * correct on both.
 *
 * `insideModal` marks the case iOS does not handle either. A `Modal` is its own
 * window, so `automaticallyAdjustKeyboardInsets` does not reach it — see
 * `components/Sheet.tsx`.
 */
import React from 'react';
import {
  Keyboard,
  KeyboardEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleProp,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { animateLayout } from '@/components/motion';
import { spacing } from '@/theme';

const isIOS = Platform.OS === 'ios';

/** Breathing room left between the focused field and the top of the keyboard. */
const FIELD_GAP = spacing.md;

/** Anything with `measureInWindow` — a View ref, or the currently focused input. */
type Measurable = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

/* ------------------------------------------------------------ ensureVisible */

/**
 * Published by the scroll container to the fields inside it.
 *
 * A `keyboardDidShow` only fires when the keyboard *opens*, so moving from one
 * field to the next while it is already up would otherwise leave the cursor
 * behind the keys. `Field` calls this on focus and the two together cover both.
 */
const EnsureVisibleContext = React.createContext<(() => void) | null>(null);

/**
 * Asks the enclosing scroll container to bring the focused field into view.
 * Returns null outside one, so a field can be used anywhere.
 */
export function useEnsureVisible() {
  return React.useContext(EnsureVisibleContext);
}

/* --------------------------------------------------------- Keyboard metrics */

/** Height of the software keyboard right now, in dp. Zero while it is closed. */
export function useKeyboardHeight() {
  const [height, setHeight] = React.useState(0);

  React.useEffect(() => {
    // `will*` fires before the keyboard animates on iOS; Android only has `did*`.
    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event: KeyboardEvent) =>
      setHeight(event.endCoordinates?.height ?? 0)
    );
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}

/**
 * True while the software keyboard is on screen.
 *
 * Every change is wrapped in a layout animation, so screens that collapse
 * decoration when the keyboard appears (the login lockup, for instance) slide
 * rather than jump.
 */
export function useKeyboardVisible() {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, () => {
      animateLayout();
      setVisible(true);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      animateLayout();
      setVisible(false);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return visible;
}

/* ------------------------------------------------------ KeyboardAwareScroll */

/**
 * Scroll container for any screen that holds a text input.
 *
 * `extraBottomSpace` is the padding under the last child — on a tab screen
 * that is the room the floating tab bar needs, elsewhere it is just breathing
 * space so the final control is not flush with the edge.
 */
export function KeyboardAwareScroll({
  children,
  contentContainerStyle,
  extraBottomSpace = spacing.xxl,
  style,
  insideModal = false,
  fill = true,
  scrollEnabled = true,
  onScrollRef,
}: {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraBottomSpace?: number;
  style?: StyleProp<ViewStyle>;
  /**
   * Set on a scroll view inside a `Modal`. A modal is its own window, so
   * neither Android's resize nor the iOS inset reaches it and the keyboard
   * height has to be accounted for by hand.
   */
  insideModal?: boolean;
  /**
   * True on a full screen: the scroller takes all the room it is given.
   * False in a bottom sheet, where it has to size to its content and only
   * shrink once that content runs past a `maxHeight` further up — `flex: 1`
   * there resolves against a parent with no height of its own and collapses
   * the sheet to nothing.
   */
  fill?: boolean;
  scrollEnabled?: boolean;
  /** Escape hatch for a caller that needs to drive the scroll itself. */
  onScrollRef?: (ref: ScrollView | null) => void;
}) {
  const scrollRef = React.useRef<ScrollView>(null);
  /** The visible frame of the scroll view — what a field has to fit inside. */
  const frameRef = React.useRef<View>(null);
  /** Live scroll offset, so a correction can be applied on top of it. */
  const offsetY = React.useRef(0);
  /**
   * Top edge of the keyboard in window coordinates — the same space
   * `measureInWindow` reports in, so the two are directly comparable.
   * `Infinity` while the keyboard is down, which makes it lose every
   * `Math.min` below without needing a special case.
   */
  const keyboardTop = React.useRef(Number.POSITIVE_INFINITY);

  /**
   * True when the platform is already making room for the keyboard, so this
   * module must not make it a second time. That is iOS on a plain screen, and
   * only there: `automaticallyAdjustKeyboardInsets` is set for exactly that
   * case below, and no version of Android does this for an edge-to-edge app.
   */
  const nativeInsetHandled = isIOS && !insideModal;

  /**
   * How much of the scroll frame the keyboard covers. Padding the content by
   * this much is what makes it possible to scroll a field out from under the
   * keyboard at all — without it there is nowhere for the last field to go.
   * Measured rather than assumed, so a window that *did* shrink contributes
   * nothing and the padding is never applied twice.
   */
  const [keyboardInset, setKeyboardInset] = React.useState(0);

  const syncInset = React.useCallback(() => {
    if (nativeInsetHandled) return;
    const frame = frameRef.current;
    if (!frame) return;
    frame.measureInWindow((_x, frameTop, _w, frameHeight) => {
      setKeyboardInset(Math.max(0, frameTop + frameHeight - keyboardTop.current));
    });
  }, [nativeInsetHandled]);

  const ensureVisible = React.useCallback(() => {
    const input = TextInput.State.currentlyFocusedInput() as Measurable | null;
    const scroll = scrollRef.current;
    const frame = frameRef.current;
    if (!input || !scroll || !frame) return;

    frame.measureInWindow((_fx, frameTop, _fw, frameHeight) => {
      input.measureInWindow((_ix, inputTop, _iw, inputHeight) => {
        /* The visible region ends at the bottom of the frame, or at the top of
           the keyboard, whichever comes first. See the note at the top of the
           file: this is what makes the same code right on an Android that
           resized its window and one that did not. */
        const viewportBottom = nativeInsetHandled
          ? frameTop + frameHeight
          : Math.min(frameTop + frameHeight, keyboardTop.current);

        const below = inputTop + inputHeight + FIELD_GAP - viewportBottom;
        if (below > 1) {
          scroll.scrollTo({ y: offsetY.current + below, animated: true });
          return;
        }

        /* The other direction: a field pushed off the *top* by the resize. */
        const above = frameTop + FIELD_GAP - inputTop;
        if (above > 1) {
          scroll.scrollTo({ y: Math.max(0, offsetY.current - above), animated: true });
        }
      });
    });
  }, [nativeInsetHandled]);

  React.useEffect(() => {
    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    let settle: ReturnType<typeof setTimeout> | undefined;

    /* Room first, then the scroll into it — a scroll cannot reach past padding
       that has not been applied yet. */
    const settleKeyboard = () => {
      syncInset();
      ensureVisible();
    };

    const show = Keyboard.addListener(showEvent, (event: KeyboardEvent) => {
      keyboardTop.current = event.endCoordinates?.screenY ?? Number.POSITIVE_INFINITY;

      /* Measured twice on purpose. `keyboardDidShow` fires when the keyboard is
         up, but on an Android that still resizes its window that resize reaches
         this layout a frame or two later, and a measurement taken before it
         lands is against the old, full-height frame. The second pass catches
         that; it is a no-op whenever the first one was enough. */
      requestAnimationFrame(settleKeyboard);
      settle = setTimeout(settleKeyboard, 150);
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = Number.POSITIVE_INFINITY;
      setKeyboardInset(0);
    });

    return () => {
      show.remove();
      hide.remove();
      if (settle) clearTimeout(settle);
    };
  }, [ensureVisible, syncInset]);

  const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const setScrollRef = React.useCallback(
    (ref: ScrollView | null) => {
      (scrollRef as React.MutableRefObject<ScrollView | null>).current = ref;
      onScrollRef?.(ref);
    },
    [onScrollRef]
  );

  /* `collapsable={false}` keeps the wrapper as a real Android view — a view
     the platform has optimised away cannot be measured. */
  const box: ViewStyle = fill ? { flex: 1 } : { flexShrink: 1 };

  return (
    <EnsureVisibleContext.Provider value={ensureVisible}>
      <View ref={frameRef} style={[box, style]} collapsable={false}>
        <ScrollView
          ref={setScrollRef}
          style={box}
          scrollEnabled={scrollEnabled}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          /* A tap on a button while the keyboard is up should press the button,
             not just close the keyboard and make the user tap again. */
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={isIOS ? 'interactive' : 'on-drag'}
          automaticallyAdjustKeyboardInsets={isIOS && !insideModal}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[
            { paddingBottom: extraBottomSpace + keyboardInset },
            contentContainerStyle,
          ]}
        >
          {children}
        </ScrollView>
      </View>
    </EnsureVisibleContext.Provider>
  );
}

/* ------------------------------------------------------- useKeyboardOverlap */

/**
 * How much of one view the keyboard is currently covering, in dp.
 *
 * The screens that scroll never ask: `KeyboardAwareScroll` measures the same
 * thing for itself and turns it straight into padding. The login screen asks
 * because it does *not* scroll — it has exactly one screenful to lay out in, so
 * before it can decide how much of the drawing it can afford it has to know how
 * much of that screenful is still visible.
 *
 * The measurement is the scroller's, and it is right on both Androids for the
 * same reason (see the file header): on a window that resized, the view's own
 * bottom edge is already above the keyboard and the overlap comes out at zero
 * without anyone asking which version this is.
 *
 * Attach `ref` and `onLayout` to the view being measured — the one that fills
 * the screen, not the one being padded, or the padding feeds back into its own
 * input.
 */
export function useKeyboardOverlap() {
  const ref = React.useRef<View>(null);
  const [overlap, setOverlap] = React.useState(0);
  /** Top edge of the keyboard in window coordinates; see `KeyboardAwareScroll`. */
  const keyboardTop = React.useRef(Number.POSITIVE_INFINITY);

  const measure = React.useCallback(() => {
    const view = ref.current;
    if (!view) return;
    view.measureInWindow((_x, top, _w, height) => {
      const next = Math.max(0, top + height - keyboardTop.current);
      setOverlap((prev) => (prev === next ? prev : next));
    });
  }, []);

  React.useEffect(() => {
    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    let settle: ReturnType<typeof setTimeout> | undefined;

    const show = Keyboard.addListener(showEvent, (event: KeyboardEvent) => {
      keyboardTop.current = event.endCoordinates?.screenY ?? Number.POSITIVE_INFINITY;
      /* Measured twice for the reason given in `KeyboardAwareScroll`: on an
         Android that still resizes its window, the resize reaches this layout a
         frame or two after the event, and a measurement taken before it lands
         is against the old, full-height frame. */
      animateLayout();
      requestAnimationFrame(measure);
      settle = setTimeout(measure, 150);
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = Number.POSITIVE_INFINITY;
      animateLayout();
      setOverlap(0);
    });

    return () => {
      show.remove();
      hide.remove();
      if (settle) clearTimeout(settle);
    };
  }, [measure]);

  /** Re-measures after a layout change — a rotation, or the frame settling. */
  const onLayout = React.useCallback(() => measure(), [measure]);

  return { ref, overlap, onLayout };
}

/**
 * Hides its children while the keyboard is up.
 * Used for footers and watermarks that only steal room when typing.
 */
export function HideOnKeyboard({ children }: { children: React.ReactNode }) {
  const open = useKeyboardVisible();
  if (open) return null;
  return <View>{children}</View>;
}
