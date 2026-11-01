import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  NotFoundException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import {
  CommerceService,
  CreateListingDto,
  UpdateListingStatusDto,
  QueryListingDto,
} from '../../../modules/commerce/public';

@Controller('commerce/listings')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN', 'HUB_OPERATOR')
export class ListingController {
  constructor(private readonly commerceService: CommerceService) {}

  // ---------------------------------------------------------------------------
  // Listing Query
  // ---------------------------------------------------------------------------

  // GET /commerce/listings?isListed=true&page=1&limit=20
  @Get()
  async getListings(@Query() query: QueryListingDto) {
    return this.commerceService.getListings({
      isListed: query.isListed,
      page: query.page,
      limit: query.limit,
    });
  }

  // ---------------------------------------------------------------------------
  // Listing Commands (Declared before :skuId to prevent route conflict)
  // ---------------------------------------------------------------------------

  // PATCH /commerce/listings/:skuId/list
  @Patch(':skuId/list')
  async listSku(@Param('skuId') skuId: string) {
    return this.commerceService.listSku(skuId);
  }

  // PATCH /commerce/listings/:skuId/unlist
  @Patch(':skuId/unlist')
  async unlistSku(@Param('skuId') skuId: string) {
    return this.commerceService.unlistSku(skuId);
  }

  // ---------------------------------------------------------------------------
  // Listing Write & Single Read
  // ---------------------------------------------------------------------------

  // POST /commerce/listings
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createListing(@Body() dto: CreateListingDto) {
    return this.commerceService.createListing(dto.skuId, dto.isListed ?? true);
  }

  // GET /commerce/listings/:skuId
  @Get(':skuId')
  async getListing(@Param('skuId') skuId: string) {
    const listing = await this.commerceService.getListing(skuId);
    if (!listing) {
      throw new NotFoundException(`Listing not found for SKU: ${skuId}`);
    }
    return listing;
  }

  // PATCH /commerce/listings/:skuId
  @Patch(':skuId')
  async updateListingStatus(
    @Param('skuId') skuId: string,
    @Body() dto: UpdateListingStatusDto,
  ) {
    if (dto.isListed) {
      return this.commerceService.listSku(skuId);
    } else {
      return this.commerceService.unlistSku(skuId);
    }
  }
}
