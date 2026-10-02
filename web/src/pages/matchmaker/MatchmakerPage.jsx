// STUB — replaced by the feature builder. Tab root for "Matchmaker".
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/kit';

export default function Page() {
  return (
    <div className="km-screen">
      <PageHeader title="Matchmaker" large />
      <div className="km-screen-body km-scroll">
        <EmptyState icon="rings" title="Matchmaker" sub="This surface is being built." />
      </div>
    </div>
  );
}
