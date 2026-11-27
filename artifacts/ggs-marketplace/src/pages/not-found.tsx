import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[60dvh] w-full items-center justify-center">
      <Card className="mx-4 w-full max-w-md border-border bg-card">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-3">
            <AlertCircle className="size-8 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">{t('notFound.title')}</h1>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t('notFound.body')}</p>
          <Button asChild className="mt-6"><Link href="/">{t('footer.brand')}</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
