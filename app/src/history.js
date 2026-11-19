// History stores decoded-photo references, never a second copy of their pixels.
// Scalar output preferences travel with the artwork; comparison is a view only.
const EDIT_FIELDS = Object.freeze([
  'size', 'title', 'subtitle', 'mood', 'grain', 'intensity',
  'textScale', 'sublineSize', 'exportType', 'jpegQuality',
]);

export function captureEdit(state) {
  return {
    ...Object.fromEntries(EDIT_FIELDS.map((key) => [key, state[key]])),
    photos: [...state.photos],
    panels: structuredClone(state.panels),
    formatCrops: structuredClone(state.formatCrops),
  };
}

function editFingerprint(edit) {
  return JSON.stringify({ ...edit, photos: edit.photos.map((photo) => photo.id) });
}

export function createHistory(state, limit = 50) {
  let entries = [];
  let cursor = 0;

  function reset() {
    const edit = captureEdit(state);
    entries = [{ edit, fingerprint: editFingerprint(edit), label: 'Starting cover', group: '' }];
    cursor = 0;
  }

  function finishGroup() {
    entries[cursor].group = '';
  }

  function record(label, group = '') {
    const edit = captureEdit(state);
    const fingerprint = editFingerprint(edit);
    if (fingerprint === entries[cursor].fingerprint) return false;
    const canMerge = group && entries[cursor].group === group && cursor === entries.length - 1 && cursor > 0;
    entries.splice(cursor + 1);
    const next = { edit, fingerprint, label, group };
    if (canMerge) entries[cursor] = next;
    else {
      entries.push(next);
      cursor++;
      if (entries.length > limit + 1) {
        entries.shift();
        cursor--;
      }
    }
    return true;
  }

  function travel(direction) {
    const next = cursor + direction;
    if (next < 0 || next >= entries.length) return false;
    finishGroup();
    cursor = next;
    const edit = entries[cursor].edit;
    Object.assign(state, edit, {
      photos: [...edit.photos],
      panels: structuredClone(edit.panels),
      formatCrops: structuredClone(edit.formatCrops),
    });
    finishGroup();
    return true;
  }

  function status() {
    return {
      undo: cursor > 0,
      redo: cursor < entries.length - 1,
      undoLabel: cursor > 0 ? entries[cursor].label : '',
      redoLabel: entries[cursor + 1]?.label || '',
      steps: cursor,
      retained: entries.length - 1,
      limit,
    };
  }

  reset();
  return Object.freeze({ record, finishGroup, reset, status, undo: () => travel(-1), redo: () => travel(1) });
}
