import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller({ path: 'service-categories', version: '1' })
export class ServiceCategoriesController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lister les catégories de services actives' })
  list() {
    return this.catalogService.listCategories({ activeOnly: true });
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Détail d’une catégorie par slug' })
  getBySlug(@Param('slug') slug: string) {
    return this.catalogService.getCategoryBySlug(slug);
  }
}

@ApiTags('catalog')
@Controller({ path: 'services', version: '1' })
export class ServicesController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Lister les services actifs' })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Slug de catégorie',
  })
  list(@Query('category') category?: string) {
    return this.catalogService.listServices({
      categorySlug: category || undefined,
      activeOnly: true,
    });
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Détail d’un service par slug (exigences actives)' })
  getBySlug(@Param('slug') slug: string) {
    return this.catalogService.getServiceBySlug(slug);
  }
}
