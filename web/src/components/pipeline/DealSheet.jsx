// STUB — replaced by the feature builder. Sheet overlay "Deal".
// Overlay contract: receives { ...props, overlayId, onClose }.
import Sheet from '../ui/Sheet';
import { EmptyState } from '../ui/kit';

export default function Overlay({ onClose }) {
  return (
    <Sheet open onClose={onClose} title="Deal">
      <EmptyState icon="sparkle" title="Deal" sub="This surface is being built." />
    </Sheet>
  );
}
