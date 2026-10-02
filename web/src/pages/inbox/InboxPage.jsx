// STUB — replaced by the feature builder. Tab root for "Inbox".
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/kit';

export default function Page() {
  return (
    <div className="km-screen">
      <PageHeader title="Inbox" large />
      <div className="km-screen-body km-scroll">
        <EmptyState icon="inbox" title="Inbox" sub="This surface is being built." />
      </div>
    </div>
  );
}
