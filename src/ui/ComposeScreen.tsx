import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addPhotos, removePhoto } from '../app/photoList';
import { Services } from '../app/services';
import { SaveReportError } from '../app/saveReport';
import { ReportValidationError, validateReportInput, ValidationError } from '../core/report';
import { MAX_IMAGES } from '../core/types';
import { cameraPermission } from '../permissions/rnCameraPermission';
import { pickFromGallery } from './photoPicker';
import { colors, HIT } from './theme';
import { usePermission } from './useCameraPermission';

type Props = Pick<Services, 'save' | 'newReportId' | 'draft'> & {
  /** Jump to the queue so the user can watch the report's status. */
  onViewReports: () => void;
};

/**
 * Compose + save. This screen holds only form state: validation rules live in
 * core, the save flow in app/saveReport, and the upload happens later in the
 * engine. "Saved" here always means "on this phone", never "uploaded".
 */
export function ComposeScreen({ save, newReportId, draft, onViewReports }: Props) {
  // One id per draft: pressing Save twice is idempotent (same report, not two).
  const draftId = useRef(newReportId());
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false); // show validation after first Save press
  const [notice, setNotice] = useState<string | null>(null); // photo-limit / picker messages
  const [cameraTried, setCameraTried] = useState(false);
  const [asking, setAsking] = useState(false); // system permission dialog is open
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const camera = usePermission(cameraPermission);
  const [restored, setRestored] = useState(false); // the draft on disk has been read

  // Android may have killed the app while the camera was open: bring back what was typed and taken.
  useEffect(() => {
    let cancelled = false;
    draft
      .load()
      .then(previous => {
        if (cancelled || !previous) {
          return;
        }
        draftId.current = previous.id;
        setDescription(previous.description);
        setPhotos(previous.photos);
      })
      .catch(() => {}) // an unreadable draft is the same as none
      .finally(() => {
        if (!cancelled) {
          setRestored(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft]);

  // Keep the draft on disk as the form changes (debounced; the camera path flushes it itself).
  useEffect(() => {
    if (!restored || saved) {
      return;
    }
    const timer = setTimeout(() => {
      draft.save({ id: draftId.current, description, photos }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [restored, saved, draft, description, photos]);

  const errors = useMemo(
    () => validateReportInput({ description, imageUris: photos }),
    [description, photos],
  );
  const errorFor = (field: ValidationError['field']) =>
    attempted ? errors.find(e => e.field === field)?.message : undefined;

  const applyPicked = (uris: string[]) => {
    const { photos: next, dropped } = addPhotos(photos, uris);
    setPhotos(next);
    setNotice(
      dropped > 0 ? `Only ${MAX_IMAGES} photos fit in a report. ${dropped} not added.` : null,
    );
  };

  const atLimit = photos.length >= MAX_IMAGES;

  const onGallery = async () => {
    if (atLimit) {
      setNotice(`A report can have at most ${MAX_IMAGES} photos. Remove one to add another.`);
      return;
    }
    const result = await pickFromGallery(MAX_IMAGES - photos.length);
    if (result.kind === 'picked') {
      applyPicked(result.uris);
    } else if (result.kind === 'error') {
      setNotice(result.message);
    }
  };

  const onCamera = async () => {
    if (atLimit) {
      setNotice(`A report can have at most ${MAX_IMAGES} photos. Remove one to add another.`);
      return;
    }
    setCameraTried(true);
    setAsking(true);
    let granted = false;
    try {
      granted = await cameraPermission.ensure();
    } finally {
      setAsking(false);
    }
    if (!granted) {
      return; // the banner below explains what to do
    }
    const result = await draft.capture({ id: draftId.current, description, photos });
    if (result.kind === 'captured') {
      applyPicked([result.uri]);
    } else if (result.kind === 'error') {
      setNotice(result.message);
    }
  };

  const onSave = async () => {
    if (saving) {
      return;
    }
    setAttempted(true);
    setSaveError(null);
    if (errors.length > 0) {
      return;
    }
    setSaving(true);
    try {
      await save({ id: draftId.current, description, photoUris: photos });
      setSaved(true);
      await draft.clear().catch(() => {}); // the report now has its own copies
    } catch (e) {
      setSaveError(
        e instanceof SaveReportError || e instanceof ReportValidationError
          ? e.message
          : 'Could not save the report. Try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    draftId.current = newReportId();
    setDescription('');
    setPhotos([]);
    setAttempted(false);
    setNotice(null);
    setSaveError(null);
    setCameraTried(false);
    setSaved(false);
  };

  if (saved) {
    return (
      <SafeAreaView style={styles.root} edges={['bottom']}>
        <View style={styles.savedWrap}>
          <View style={styles.savedBadge}>
            <Text style={styles.savedTick}>✓</Text>
          </View>
          <Text style={styles.savedTitle} accessibilityRole="header">
            Saved on this phone
          </Text>
          <Text style={styles.savedBody}>
            Your report is stored safely. It will be sent to the server automatically once there is a connection.
          </Text>
          <PrimaryButton label="New report" onPress={reset} />
          <SecondaryButton label="See status" onPress={onViewReports} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding">
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <Text style={styles.label}>What did you find?</Text>
          <TextInput
            style={[styles.input, errorFor('description') ? styles.inputError : null]}
            value={description}
            onChangeText={setDescription}
            placeholder="Short description of the issue"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Description"
          />
          {errorFor('description') ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {errorFor('description')}
            </Text>
          ) : null}

          <Text style={[styles.label, styles.sectionGap]}>
            Photos ({photos.length}/{MAX_IMAGES})
          </Text>
          <View style={styles.grid}>
            {photos.map((uri, i) => (
              <View key={uri} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} accessibilityLabel={`Photo ${i + 1}`} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  onPress={() => {
                    setPhotos(p => removePhoto(p, uri));
                    setNotice(null);
                  }}
                  hitSlop={8}
                  style={styles.remove}>
                  <Text style={styles.removeText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
          <View style={styles.row}>
            <SecondaryButton label="Take photo" onPress={onCamera} style={styles.flex} />
            <SecondaryButton label="From gallery" onPress={onGallery} style={styles.flex} />
          </View>

          {errorFor('images') ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {errorFor('images')}
            </Text>
          ) : null}
          {notice ? (
            <Text style={styles.noticeText} accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}

          {cameraTried && !asking && camera === 'denied' ? (
            <Banner
              tone="warn"
              text="The camera needs your permission to take photos."
              action="Allow camera"
              onAction={() => cameraPermission.ensure()}
            />
          ) : null}
          {cameraTried && !asking && camera === 'blocked' ? (
            <Banner
              tone="warn"
              text="Camera access is blocked. Turn it on in Settings, then come back — no restart needed."
              action="Open Settings"
              onAction={() => Linking.openSettings()}
            />
          ) : null}

          {saveError ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}
          <PrimaryButton
            label={saving ? 'Saving…' : 'Save report'}
            onPress={onSave}
            disabled={saving}
          />
          <Text style={styles.hint}>Saving works without internet.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PrimaryButton(props: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.primary, props.disabled ? styles.primaryDisabled : null]}>
      <Text style={styles.primaryText}>{props.label}</Text>
    </Pressable>
  );
}

function SecondaryButton(props: {
  label: string;
  onPress: () => void;
  style?: object;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={[styles.secondary, props.style]}>
      <Text style={styles.secondaryText}>{props.label}</Text>
    </Pressable>
  );
}

function Banner(props: { tone: 'warn'; text: string; action: string; onAction: () => void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{props.text}</Text>
      <Pressable accessibilityRole="button" onPress={props.onAction} style={styles.bannerButton}>
        <Text style={styles.bannerButtonText}>{props.action}</Text>
      </Pressable>
    </View>
  );
}

const THUMB = 96;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, gap: 10 },
  label: { fontSize: 16, fontWeight: '700', color: colors.text },
  sectionGap: { marginTop: 12 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  errorText: { color: colors.danger, fontSize: 14 },
  noticeText: { color: colors.warnText, fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumbWrap: { width: THUMB, height: THUMB },
  thumb: { width: THUMB, height: THUMB, borderRadius: 8, backgroundColor: colors.surface },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  secondary: {
    minHeight: HIT,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  primary: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryDisabled: { opacity: 0.6 },
  primaryText: { color: colors.primaryText, fontSize: 17, fontWeight: '700' },
  hint: { textAlign: 'center', color: colors.muted, fontSize: 13 },
  banner: { backgroundColor: colors.warnBg, borderRadius: 10, padding: 12, gap: 8 },
  bannerText: { color: colors.warnText, fontSize: 15 },
  bannerButton: {
    minHeight: HIT,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warnText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerButtonText: { color: colors.warnText, fontSize: 16, fontWeight: '700' },
  savedWrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  savedBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  savedTick: { fontSize: 36, color: colors.successText },
  savedTitle: { fontSize: 24, fontWeight: '700', textAlign: 'center', color: colors.text },
  savedBody: { fontSize: 16, textAlign: 'center', color: colors.muted, lineHeight: 22 },
});
