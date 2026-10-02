import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import {
  CreateDocumentTypeDto,
  ListDocumentTypesQueryDto,
  UpdateDocumentTypeDto,
} from './dto/document-type.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { AdminListCategoriesQueryDto } from './dto/admin-list-categories-query.dto';
import { AdminListServicesQueryDto } from './dto/admin-list-services-query.dto';

@ApiTags('admin-catalog')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminCatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('catalog/overview')
  @ApiOperation({ summary: 'Vue d’ensemble du catalogue (admin)' })
  getCatalogOverview() {
    return this.catalogService.getAdminCatalogOverview();
  }

  @Get('service-categories')
  @ApiOperation({
    summary: 'Lister toutes les catégories (actives et inactives)',
  })
  listCategories(@Query() query: AdminListCategoriesQueryDto) {
    return this.catalogService.adminListCategories(query);
  }

  @Get('service-categories/:id')
  @ApiOperation({ summary: 'Détail d’une catégorie par UUID' })
  getCategoryById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.adminGetCategoryById(id);
  }

  @Get('services')
  @ApiOperation({ summary: 'Lister les services du catalogue (paginé)' })
  listServices(@Query() query: AdminListServicesQueryDto) {
    return this.catalogService.adminListServices(query);
  }

  @Get('services/:id')
  @ApiOperation({ summary: 'Détail d’un service par UUID' })
  getServiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.adminGetServiceById(id);
  }

  @Get('document-types')
  @ApiOperation({
    summary:
      'Types de document (recherche, filtre professionnel hors identité globale)',
  })
  listDocumentTypes(@Query() query: ListDocumentTypesQueryDto) {
    return this.catalogService.adminListDocumentTypes(query);
  }

  @Post('document-types')
  @ApiOperation({
    summary: 'Créer un type de document (ou réutiliser un équivalent)',
  })
  createDocumentType(@Body() dto: CreateDocumentTypeDto) {
    return this.catalogService.createDocumentType(dto);
  }

  @Patch('document-types/:id')
  @ApiOperation({ summary: 'Modifier / désactiver un type de document' })
  updateDocumentType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentTypeDto,
  ) {
    return this.catalogService.updateDocumentType(id, dto);
  }

  @Post('service-categories')
  @ApiOperation({ summary: 'Créer une catégorie' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalogService.createCategory(dto);
  }

  @Patch('service-categories/:id')
  @ApiOperation({ summary: 'Modifier / désactiver une catégorie' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.catalogService.updateCategory(id, dto);
  }

  @Post('services')
  @ApiOperation({ summary: 'Créer un service' })
  createService(@Body() dto: CreateServiceDto) {
    return this.catalogService.createService(dto);
  }

  @Patch('services/:id')
  @ApiOperation({ summary: 'Modifier / désactiver un service' })
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.catalogService.updateService(id, dto);
  }

  @Post('services/:id/requirements')
  @ApiOperation({ summary: 'Ajouter une exigence à un service' })
  createRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.catalogService.createRequirement(id, dto);
  }

  @Patch('service-requirements/:id')
  @ApiOperation({ summary: 'Modifier / désactiver une exigence' })
  updateRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.catalogService.updateRequirement(id, dto);
  }
}
