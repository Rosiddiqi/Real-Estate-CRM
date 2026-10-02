// STUB — replaced by the feature builder. Sheet overlay "Quick Text".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="Quick Text">
      <EmptyState icon="sparkle" title="Quick Text" sub="This surface is being built." />
    </Sheet>
  );
}
